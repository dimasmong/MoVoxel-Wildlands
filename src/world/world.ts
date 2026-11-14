import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT, chunkKey, localIndex } from '../core/constants';
import { Chunk } from './chunk';
import { meshChunk, type MeshData } from './mesher';
import { TerrainGenerator } from './generator';
import type { WorldMaterials } from '../render/materials';
import { B } from './registry';

export type EditMap = Map<string, Map<number, number>>;

interface PendingJob {
  cx: number;
  cz: number;
  job: number;
}

/** Owns loaded chunks, the player's edit layer, streaming and mesh lifecycle. */
export class World {
  readonly seed: number;
  readonly chunks = new Map<string, Chunk>();
  /** Player edits per chunk: localIndex -> blockId. This is what gets saved. */
  readonly edits: EditMap;
  readonly dirtyEditChunks = new Set<string>();
  readonly group = new THREE.Group();
  renderDistance = 6;

  private gen: TerrainGenerator;
  private workers: Worker[] = [];
  private workerLoad: number[] = [];
  private pending = new Map<string, PendingJob>();
  private queue: Array<{ cx: number; cz: number; d: number }> = [];
  private jobCounter = 0;
  private lastCenter = '';
  private materials: WorldMaterials;
  private disposed = false;
  lastMeshMs = 0;
  meshedThisFrame = 0;

  constructor(seed: number, materials: WorldMaterials, edits: EditMap) {
    this.seed = seed >>> 0;
    this.materials = materials;
    this.edits = edits;
    this.gen = new TerrainGenerator(this.seed);
    this.group.name = 'world';
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./generator.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this.onWorkerMessage(e.data);
        w.onerror = (err) => console.warn('Generator worker error, falling back to main thread', err);
        this.workers.push(w);
        this.workerLoad.push(0);
      }
    } catch (err) {
      console.warn('Web Workers unavailable; generating on main thread.', err);
      this.workers = [];
    }
  }

  get generator(): TerrainGenerator {
    return this.gen;
  }

  // ------------------------------------------------------------------ block access
  getChunkAt(wx: number, wz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE)));
  }

  isLoadedAt(wx: number, wz: number): boolean {
    return this.getChunkAt(wx, wz) !== undefined;
  }

  getBlock(wx: number, wy: number, wz: number): number {
    if (wy < 0) return B.DEEPSTONE;
    if (wy >= WORLD_HEIGHT) return B.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return -1; // unloaded
    return c.data[localIndex(wx - cx * CHUNK_SIZE, wy, wz - cz * CHUNK_SIZE)];
  }

  setBlock(wx: number, wy: number, wz: number, id: number): boolean {
    if (wy < 0 || wy >= WORLD_HEIGHT) return false;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = chunkKey(cx, cz);
    const c = this.chunks.get(key);
    if (!c) return false;
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    const idx = localIndex(lx, wy, lz);
    if (c.data[idx] === id) return false;
    c.data[idx] = id;
    if (id !== 0 && wy + 1 > c.topY) c.topY = wy + 1;
    let e = this.edits.get(key);
    if (!e) this.edits.set(key, (e = new Map()));
    e.set(idx, id);
    this.dirtyEditChunks.add(key);
    c.dirty = true;
    // Border edits invalidate neighbour meshes (faces + AO), including diagonals at corners.
    const nx = lx === 0 ? -1 : lx === CHUNK_SIZE - 1 ? 1 : 0;
    const nz = lz === 0 ? -1 : lz === CHUNK_SIZE - 1 ? 1 : 0;
    if (nx) this.markDirty(cx + nx, cz);
    if (nz) this.markDirty(cx, cz + nz);
    if (nx && nz) this.markDirty(cx + nx, cz + nz);
    return true;
  }

  private markDirty(cx: number, cz: number): void {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) c.dirty = true;
  }

  /** Highest non-air, non-plant block in a column, or -1. */
  surfaceY(wx: number, wz: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const b = this.getBlock(wx, y, wz);
      if (b > 0 && b !== B.WATER && b !== B.TALL_GRASS) return y;
    }
    return -1;
  }

  // ------------------------------------------------------------------ streaming
  private onWorkerMessage(msg: { type: string; cx: number; cz: number; job: number; data: Uint8Array }): void {
    if (this.disposed || msg.type !== 'chunk') return;
    const key = chunkKey(msg.cx, msg.cz);
    const p = this.pending.get(key);
    const wi = this.workerIndexForJob(msg.job);
    if (wi >= 0) this.workerLoad[wi] = Math.max(0, this.workerLoad[wi] - 1);
    if (!p || p.job !== msg.job) return;
    this.pending.delete(key);
    this.addChunk(msg.cx, msg.cz, msg.data);
  }

  private workerIndexForJob(job: number): number {
    return this.workers.length ? job % this.workers.length : -1;
  }

  private addChunk(cx: number, cz: number, data: Uint8Array): void {
    const key = chunkKey(cx, cz);
    const e = this.edits.get(key);
    if (e) for (const [idx, id] of e) data[idx] = id;
    const chunk = new Chunk(cx, cz, data);
    this.chunks.set(key, chunk);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) this.markDirty(cx + dx, cz + dz);
  }

  private request(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const job = ++this.jobCounter;
    if (this.workers.length === 0) {
      this.addChunk(cx, cz, this.gen.generateChunk(cx, cz));
      return;
    }
    this.pending.set(key, { cx, cz, job });
    const wi = job % this.workers.length;
    this.workerLoad[wi]++;
    this.workers[wi].postMessage({ type: 'gen', seed: this.seed, cx, cz, job });
  }

  /** Synchronously generates the chunks around a point (used for spawn safety). */
  ensureLoadedSync(wx: number, wz: number, radius: number): void {
    const pcx = Math.floor(wx / CHUNK_SIZE);
    const pcz = Math.floor(wz / CHUNK_SIZE);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const key = chunkKey(pcx + dx, pcz + dz);
        if (this.chunks.has(key)) continue;
        this.pending.delete(key);
        this.addChunk(pcx + dx, pcz + dz, this.gen.generateChunk(pcx + dx, pcz + dz));
      }
    }
  }

  update(px: number, pz: number, meshBudgetMs: number): void {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const r = this.renderDistance;
    const center = `${pcx},${pcz},${r}`;
    if (center !== this.lastCenter) {
      this.lastCenter = center;
      this.rebuildQueue(pcx, pcz, r);
      this.unloadFar(pcx, pcz, r);
    }
    // Dispatch generation requests, nearest first, bounded in-flight per worker.
    const maxInFlight = this.workers.length ? this.workers.length * 2 : 1;
    let syncBudget = this.workers.length ? Infinity : 1;
    while (this.queue.length && this.pending.size < maxInFlight && syncBudget-- > 0) {
      const q = this.queue.shift()!;
      const key = chunkKey(q.cx, q.cz);
      if (this.chunks.has(key) || this.pending.has(key)) continue;
      this.request(q.cx, q.cz);
    }
    this.processMeshes(pcx, pcz, r, meshBudgetMs);
  }

  private rebuildQueue(pcx: number, pcz: number, r: number): void {
    const want: Array<{ cx: number; cz: number; d: number }> = [];
    const lr = r + 1;
    for (let dz = -lr; dz <= lr; dz++) {
      for (let dx = -lr; dx <= lr; dx++) {
        const d = dx * dx + dz * dz;
        if (d > (lr + 0.5) * (lr + 0.5)) continue;
        const key = chunkKey(pcx + dx, pcz + dz);
        if (this.chunks.has(key) || this.pending.has(key)) continue;
        want.push({ cx: pcx + dx, cz: pcz + dz, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    this.queue = want;
    // Drop stale pending jobs far away (results will be ignored).
    for (const [key, p] of this.pending) {
      const dx = p.cx - pcx, dz = p.cz - pcz;
      if (dx * dx + dz * dz > (lr + 2) * (lr + 2)) this.pending.delete(key);
    }
  }

  private unloadFar(pcx: number, pcz: number, r: number): void {
    const limit = (r + 3) * (r + 3);
    for (const [key, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > limit) {
        this.disposeChunkMeshes(c);
        this.chunks.delete(key);
      }
    }
  }

  private hasAllNeighbours(c: Chunk): boolean {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(chunkKey(c.cx + dx, c.cz + dz))) return false;
    return true;
  }

  private processMeshes(pcx: number, pcz: number, r: number, budgetMs: number): void {
    const t0 = performance.now();
    const candidates: Array<{ c: Chunk; d: number }> = [];
    const rr = (r + 0.5) * (r + 0.5);
    for (const c of this.chunks.values()) {
      if (!c.dirty) continue;
      const dx = c.cx - pcx, dz = c.cz - pcz;
      const d = dx * dx + dz * dz;
      if (d > rr) continue;
      if (!this.hasAllNeighbours(c)) continue;
      candidates.push({ c, d });
    }
    candidates.sort((a, b) => a.d - b.d);
    let built = 0;
    for (const { c } of candidates) {
      if (built > 0 && performance.now() - t0 > budgetMs) break;
      this.buildMesh(c);
      built++;
    }
    this.meshedThisFrame = built;
    if (built) this.lastMeshMs = (performance.now() - t0) / built;
    // Hide meshes outside the circular render distance.
    for (const c of this.chunks.values()) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      const vis = dx * dx + dz * dz <= rr;
      for (const m of c.meshes) m.visible = vis;
    }
  }

  /** Rebuild a chunk's mesh immediately (used right after the player edits a block). */
  rebuildNow(wx: number, wz: number): void {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (c && c.dirty && this.hasAllNeighbours(c)) this.buildMesh(c);
      }
    }
  }

  private buildMesh(c: Chunk): void {
    const nb: Array<Uint8Array | undefined> = [];
    let top = c.topY;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz));
        nb.push(n?.data);
      }
    }
    top = Math.min(WORLD_HEIGHT, top + 1);
    const out = meshChunk(nb, top);
    this.disposeChunkMeshes(c);
    const add = (data: MeshData | null, mat: THREE.Material, order: number, shadows: boolean) => {
      if (!data) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
      g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      g.setIndex(new THREE.BufferAttribute(data.indices, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.position.set(c.cx * CHUNK_SIZE, 0, c.cz * CHUNK_SIZE);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.renderOrder = order;
      m.castShadow = shadows;
      m.receiveShadow = true;
      this.group.add(m);
      c.meshes.push(m);
    };
    add(out.opaque, this.materials.opaque, 0, true);
    add(out.cross, this.materials.cross, 1, false);
    add(out.water, this.materials.water, 2, false);
    c.dirty = false;
    c.meshed = true;
  }

  private disposeChunkMeshes(c: Chunk): void {
    for (const m of c.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    c.meshes = [];
  }

  /** Fraction of chunks within `radius` that are generated and meshed (for the loading screen). */
  readiness(px: number, pz: number, radius: number): number {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    let total = 0, ready = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > (radius + 0.5) * (radius + 0.5)) continue;
        total++;
        const c = this.chunks.get(chunkKey(pcx + dx, pcz + dz));
        if (c && c.meshed) ready++;
      }
    }
    return total ? ready / total : 1;
  }

  stats(): { loaded: number; meshed: number; pending: number; queued: number } {
    let meshed = 0;
    for (const c of this.chunks.values()) if (c.meshed) meshed++;
    return { loaded: this.chunks.size, meshed, pending: this.pending.size, queued: this.queue.length };
  }

  setShadowCasting(on: boolean): void {
    for (const c of this.chunks.values()) for (const m of c.meshes) if (m.material === this.materials.opaque) m.castShadow = on;
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (const c of this.chunks.values()) this.disposeChunkMeshes(c);
    this.chunks.clear();
    this.group.removeFromParent();
  }
}
