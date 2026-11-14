import { SAVE_VERSION, GENERATOR_VERSION } from '../core/constants';
import type { EditMap } from '../world/world';

export type GameMode = 'survival' | 'creative';

export interface PlayerState {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  health: number; hunger: number;
  flying: boolean;
  spawn: { x: number; y: number; z: number };
}

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  seedText: string;
  mode: GameMode;
  created: number;
  lastPlayed: number;
  version: number;
  generatorVersion: number;
  player: PlayerState | null;
  inventory: unknown;
  selected: number;
  time: number; // 0..1 day fraction, 0.25 = noon
  day: number;
  daylightCycle: boolean;
}

interface ChunkRecord {
  k: string;
  world: string;
  edits: number[]; // flat [index, id, index, id, ...]
}

const DB_NAME = 'movoxel-wildlands';
const DB_VERSION = 1;

export class NewerSaveError extends Error {}

/** Migrations from version v to v+1. Keep every entry forever (save-systems skill). */
const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // Version 0 = pre-release saves without a version field.
  0: (d) => ({ ...d, daylightCycle: d.daylightCycle ?? true, day: d.day ?? 0 }),
};

export function migrateMeta(raw: unknown): WorldMeta {
  if (!raw || typeof raw !== 'object') throw new Error('World record is not an object');
  let d = { ...(raw as Record<string, unknown>) };
  let v = Number(d.version ?? 0);
  if (!Number.isFinite(v)) v = 0;
  if (v > SAVE_VERSION) throw new NewerSaveError(`Save version ${v} is newer than this build (${SAVE_VERSION}).`);
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (m) d = m(d);
    v++;
    d.version = v;
  }
  if (typeof d.id !== 'string' || typeof d.name !== 'string' || !Number.isFinite(Number(d.seed))) {
    throw new Error('World record is missing id/name/seed');
  }
  const mode: GameMode = d.mode === 'creative' ? 'creative' : 'survival';
  return {
    id: d.id,
    name: String(d.name).slice(0, 40),
    seed: Number(d.seed) >>> 0,
    seedText: typeof d.seedText === 'string' ? d.seedText : String(d.seed),
    mode,
    created: Number(d.created) || Date.now(),
    lastPlayed: Number(d.lastPlayed) || Date.now(),
    version: SAVE_VERSION,
    generatorVersion: Number(d.generatorVersion) || GENERATOR_VERSION,
    player: validatePlayer(d.player),
    inventory: d.inventory ?? [],
    selected: Number(d.selected) || 0,
    time: Number.isFinite(Number(d.time)) ? ((Number(d.time) % 1) + 1) % 1 : 0.3,
    day: Number(d.day) || 0,
    daylightCycle: d.daylightCycle !== false,
  };
}

function validatePlayer(p: unknown): PlayerState | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const num = (v: unknown, def: number) => (Number.isFinite(Number(v)) ? Number(v) : def);
  const x = num(o.x, NaN), y = num(o.y, NaN), z = num(o.z, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const sp = (o.spawn ?? {}) as Record<string, unknown>;
  return {
    x, y: Math.max(1, Math.min(300, y)), z,
    yaw: num(o.yaw, 0), pitch: num(o.pitch, 0),
    health: Math.max(1, Math.min(20, num(o.health, 20))),
    hunger: Math.max(0, Math.min(20, num(o.hunger, 20))),
    flying: o.flying === true,
    spawn: { x: num(sp.x, x), y: num(sp.y, y), z: num(sp.z, z) },
  };
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export class SaveStore {
  private db: IDBDatabase | null = null;
  /** In-memory fallback when IndexedDB is unavailable (e.g. some private modes). */
  private memory: { worlds: Map<string, WorldMeta>; chunks: Map<string, ChunkRecord> } | null = null;
  warning = '';

  async open(): Promise<void> {
    if (this.db || this.memory) return;
    try {
      if (!('indexedDB' in window)) throw new Error('IndexedDB not supported');
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('chunks')) {
            const s = db.createObjectStore('chunks', { keyPath: 'k' });
            s.createIndex('world', 'world', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('Database blocked by another tab'));
      });
    } catch (err) {
      console.warn('IndexedDB unavailable, saves will only last this session.', err);
      this.warning = 'Local storage is unavailable in this browser mode. Worlds will be lost when you close the tab.';
      this.memory = { worlds: new Map(), chunks: new Map() };
    }
  }

  async listWorlds(): Promise<{ worlds: WorldMeta[]; broken: string[] }> {
    await this.open();
    const broken: string[] = [];
    let raws: unknown[];
    if (this.memory) raws = [...this.memory.worlds.values()];
    else raws = await reqToPromise(this.db!.transaction('worlds').objectStore('worlds').getAll());
    const worlds: WorldMeta[] = [];
    for (const r of raws) {
      try {
        worlds.push(migrateMeta(r));
      } catch (err) {
        const id = (r as { id?: string })?.id ?? '?';
        const backup = await this.loadBackup(id);
        if (backup) worlds.push(backup);
        else broken.push(`${(r as { name?: string })?.name ?? id}: ${(err as Error).message}`);
      }
    }
    worlds.sort((a, b) => b.lastPlayed - a.lastPlayed);
    return { worlds, broken };
  }

  private async loadBackup(id: string): Promise<WorldMeta | null> {
    if (this.memory || !this.db) return null;
    try {
      const raw = await reqToPromise(this.db.transaction('backups').objectStore('backups').get(id));
      return raw ? migrateMeta(raw) : null;
    } catch {
      return null;
    }
  }

  async loadEdits(worldId: string): Promise<EditMap> {
    await this.open();
    const edits: EditMap = new Map();
    let recs: ChunkRecord[];
    if (this.memory) recs = [...this.memory.chunks.values()].filter((c) => c.world === worldId);
    else {
      const idx = this.db!.transaction('chunks').objectStore('chunks').index('world');
      recs = await reqToPromise(idx.getAll(IDBKeyRange.only(worldId)));
    }
    for (const r of recs) {
      if (!r || !Array.isArray(r.edits)) continue;
      const ck = r.k.slice(worldId.length + 1);
      const m = new Map<number, number>();
      for (let i = 0; i + 1 < r.edits.length; i += 2) {
        const idx = r.edits[i] | 0, id = r.edits[i + 1] | 0;
        if (idx >= 0 && idx < 16 * 16 * 128 && id >= 0 && id < 64) m.set(idx, id);
      }
      edits.set(ck, m);
    }
    return edits;
  }

  /** Saves world metadata and changed chunks in one atomic transaction; keeps the previous meta as a backup. */
  async saveWorld(meta: WorldMeta, edits: EditMap, dirtyKeys: Iterable<string>): Promise<void> {
    await this.open();
    meta.version = SAVE_VERSION;
    meta.lastPlayed = Date.now();
    const records: ChunkRecord[] = [];
    for (const ck of dirtyKeys) {
      const m = edits.get(ck);
      if (!m) continue;
      const flat: number[] = [];
      for (const [i, id] of m) flat.push(i, id);
      records.push({ k: `${meta.id}|${ck}`, world: meta.id, edits: flat });
    }
    const plain = JSON.parse(JSON.stringify(meta)) as WorldMeta;
    if (this.memory) {
      this.memory.worlds.set(meta.id, plain);
      for (const r of records) this.memory.chunks.set(r.k, r);
      return;
    }
    const tx = this.db!.transaction(['worlds', 'backups', 'chunks'], 'readwrite');
    const worlds = tx.objectStore('worlds');
    const prev = await reqToPromise(worlds.get(meta.id)).catch(() => undefined);
    if (prev) tx.objectStore('backups').put(prev);
    worlds.put(plain);
    const chunks = tx.objectStore('chunks');
    for (const r of records) chunks.put(r);
    await txDone(tx);
  }

  async deleteWorld(id: string): Promise<void> {
    await this.open();
    if (this.memory) {
      this.memory.worlds.delete(id);
      for (const k of [...this.memory.chunks.keys()]) if (k.startsWith(id + '|')) this.memory.chunks.delete(k);
      return;
    }
    const tx = this.db!.transaction(['worlds', 'backups', 'chunks'], 'readwrite');
    tx.objectStore('worlds').delete(id);
    tx.objectStore('backups').delete(id);
    const idx = tx.objectStore('chunks').index('world');
    const keys = await reqToPromise(idx.getAllKeys(IDBKeyRange.only(id)));
    for (const k of keys) tx.objectStore('chunks').delete(k);
    await txDone(tx);
  }
}

export const saveStore = new SaveStore();

export function newWorldId(): string {
  return `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
