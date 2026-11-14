import { SimplexNoise } from '../core/noise';
import { hash2, mulberry32 } from '../core/rng';
import { CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL, WORLD_HEIGHT, localIndex } from '../core/constants';
import { B } from './registry';

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface ColumnInfo {
  height: number; // y of the top solid block
  desert: number; // biome weights 0..1, sum to 1
  forest: number;
  plains: number;
  surface: number; // top block id
}

const TREE_CELL = 5;
const LANDMARK_REGION = 112;

/**
 * Deterministic terrain generator. Every field uses its own seeded noise instance so biome
 * fields never line up with elevation (procedural-gen skill: "correlated noise fields").
 */
export class TerrainGenerator {
  readonly seed: number;
  private nCont: SimplexNoise;
  private nHills: SimplexNoise;
  private nDetail: SimplexNoise;
  private nTemp: SimplexNoise;
  private nMoist: SimplexNoise;
  private nDune: SimplexNoise;
  private nMount: SimplexNoise;
  private nPond: SimplexNoise;
  private nCaveA: SimplexNoise;
  private nCaveB: SimplexNoise;
  private nCavern: SimplexNoise;
  private nEntrance: SimplexNoise;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    let s = this.seed;
    const next = () => (s = (Math.imul(s ^ (s >>> 16), 0x45d9f3b) + 0x9e3779b9) >>> 0);
    this.nCont = new SimplexNoise(next());
    this.nHills = new SimplexNoise(next());
    this.nDetail = new SimplexNoise(next());
    this.nTemp = new SimplexNoise(next());
    this.nMoist = new SimplexNoise(next());
    this.nDune = new SimplexNoise(next());
    this.nMount = new SimplexNoise(next());
    this.nPond = new SimplexNoise(next());
    this.nCaveA = new SimplexNoise(next());
    this.nCaveB = new SimplexNoise(next());
    this.nCavern = new SimplexNoise(next());
    this.nEntrance = new SimplexNoise(next());
  }

  biome(x: number, z: number): { desert: number; forest: number; plains: number } {
    const temp = this.nTemp.fbm2(x / 520, z / 520, 3);
    const moist = this.nMoist.fbm2(x / 430 + 31.7, z / 430 - 12.1, 3);
    const desert = smoothstep(0.1, 0.3, temp - moist * 0.6);
    const forest = smoothstep(-0.02, 0.22, moist) * (1 - desert);
    const plains = Math.max(0, 1 - desert - forest);
    return { desert, forest, plains };
  }

  column(x: number, z: number): ColumnInfo {
    const { desert, forest, plains } = this.biome(x, z);
    const cont = this.nCont.fbm2(x / 680, z / 680, 3);
    const hills = this.nHills.fbm2(x / 150, z / 150, 4);
    const detail = this.nDetail.fbm2(x / 38, z / 38, 3);
    const dune = 1 - Math.abs(this.nDune.noise2(x / 60, z / 38));

    const plainsH = 3 + hills * 5 + detail * 1.4;
    const forestH = 5 + hills * 11 + detail * 2.6;
    const desertH = 2.5 + dune * dune * 6 + detail * 0.8;
    let h = SEA_LEVEL + 3 + cont * 9 + plains * plainsH + forest * forestH + desert * desertH;

    // Rolling highlands -> occasional big hills that read as landmarks from far away.
    const m = this.nMount.fbm2(x / 260, z / 260, 3);
    h += Math.max(0, m - 0.28) * 70 * (1 - desert * 0.7);

    // Ponds and lakes: smooth depressions that drop below sea level and fill with water.
    const pond = this.nPond.noise2(x / 85, z / 85);
    if (pond > 0.5) h -= (pond - 0.5) * 36 * (1 - desert * 0.8);

    const height = Math.max(4, Math.min(WORLD_HEIGHT - 24, Math.floor(h)));

    let surface: number = B.GRASS;
    const dither = (hash2(x, z, this.seed ^ 0x51ed) - 0.5) * 0.18;
    if (height <= SEA_LEVEL + 1) surface = B.SAND;
    else if (desert + dither > 0.5) surface = B.SAND;
    else if (height > SEA_LEVEL + 42 + dither * 20) surface = B.STONE;
    return { height, desert, forest, plains, surface };
  }

  /** Fills a chunk with base terrain. Player edits are applied later by the World. */
  generateChunk(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CHUNK_VOLUME);
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;
    const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const surfaces = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomes: ColumnInfo[] = new Array(CHUNK_SIZE * CHUNK_SIZE);

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = ox + x;
        const wz = oz + z;
        const col = this.column(wx, wz);
        const ci = x + z * CHUNK_SIZE;
        heights[ci] = col.height;
        surfaces[ci] = col.surface;
        biomes[ci] = col;
        const h = col.height;
        const isDesert = col.surface === B.SAND && h > SEA_LEVEL + 1;
        const soilDepth = 3 + Math.floor(hash2(wx, wz, this.seed ^ 0x77) * 2);

        for (let y = 0; y <= h; y++) {
          let id: number;
          if (y === 0) id = B.DEEPSTONE;
          else if (y <= 2 && hash2(wx * 7 + y, wz, this.seed ^ 0xdee) < 0.5) id = B.DEEPSTONE;
          else if (y === h) id = col.surface;
          else if (y > h - soilDepth) {
            if (col.surface === B.SAND) id = B.SAND;
            else if (col.surface === B.STONE) id = B.STONE;
            else id = B.SOIL;
          } else if (isDesert && y > h - soilDepth - 4) id = B.SANDSTONE;
          else id = B.STONE;
          data[localIndex(x, y, z)] = id;
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) data[localIndex(x, y, z)] = B.WATER;
      }
    }

    this.carveCaves(data, ox, oz, heights);
    this.placeOres(data, cx, cz);
    this.placeTrees(data, ox, oz);
    this.placeLandmarks(data, ox, oz);
    this.placePlants(data, ox, oz, heights, biomes);
    return data;
  }

  private carveCaves(data: Uint8Array, ox: number, oz: number, heights: Int16Array): void {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = ox + x;
        const wz = oz + z;
        const h = heights[x + z * CHUNK_SIZE];
        const wet = h <= SEA_LEVEL + 2;
        const entrance = this.nEntrance.noise2(wx / 50, wz / 50) > 0.62 && !wet;
        const top = wet ? h - 7 : entrance ? h : h - 5;
        for (let y = 3; y <= top; y++) {
          const idx = localIndex(x, y, z);
          const id = data[idx];
          if (id === B.WATER || id === B.AIR) continue;
          const a = this.nCaveA.noise3(wx / 38, y / 24, wz / 38);
          const b = this.nCaveB.noise3(wx / 38 + 91, y / 24, wz / 38 - 47);
          let carve = a * a + b * b < 0.011;
          if (!carve && y < 28) carve = this.nCavern.noise3(wx / 64, y / 30, wz / 64) > 0.66;
          if (carve) data[idx] = B.AIR;
        }
      }
    }
  }

  private placeOres(data: Uint8Array, cx: number, cz: number): void {
    const rand = mulberry32((Math.imul(cx, 0x1f1f1f1f) ^ Math.imul(cz, 0x5bd1e995) ^ this.seed) >>> 0);
    const veins: Array<[number, number, number, number, number]> = [
      // [blockId, attempts, minSize, maxSize, maxY]
      [B.COAL_ORE, 16, 4, 9, 80],
      [B.COPPER_ORE, 9, 3, 7, 52],
      [B.CRYSTAL_ORE, 3, 2, 4, 22],
    ];
    for (const [ore, attempts, minS, maxS, maxY] of veins) {
      for (let a = 0; a < attempts; a++) {
        let x = Math.floor(rand() * CHUNK_SIZE);
        let y = 3 + Math.floor(rand() * (maxY - 3));
        let z = Math.floor(rand() * CHUNK_SIZE);
        const size = minS + Math.floor(rand() * (maxS - minS + 1));
        for (let s = 0; s < size; s++) {
          if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y > 0 && y < WORLD_HEIGHT) {
            const idx = localIndex(x, y, z);
            if (data[idx] === B.STONE) data[idx] = ore;
          }
          const dir = Math.floor(rand() * 6);
          if (dir === 0) x++; else if (dir === 1) x--; else if (dir === 2) y++;
          else if (dir === 3) y--; else if (dir === 4) z++; else z--;
        }
      }
    }
  }

  private set(data: Uint8Array, ox: number, oz: number, wx: number, y: number, wz: number, id: number, force: boolean): void {
    const x = wx - ox;
    const z = wz - oz;
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 1 || y >= WORLD_HEIGHT) return;
    const idx = localIndex(x, y, z);
    const cur = data[idx];
    if (force || cur === B.AIR || cur === B.TALL_GRASS) data[idx] = id;
  }

  /** Tree candidates on a jittered grid (one per 5x5 cell) so trees never fuse into blobs. */
  treeAt(cellX: number, cellZ: number): { x: number; z: number; kind: 'oak' | 'pine' | 'cactus'; height: number; base: number } | null {
    const s = this.seed ^ 0x7ee5;
    const x = cellX * TREE_CELL + Math.floor(hash2(cellX, cellZ, s) * TREE_CELL);
    const z = cellZ * TREE_CELL + Math.floor(hash2(cellX, cellZ, s ^ 0xabc) * TREE_CELL);
    const roll = hash2(cellX, cellZ, s ^ 0x1234);
    const col = this.column(x, z);
    if (col.height <= SEA_LEVEL + 1) return null;
    const hRoll = hash2(x, z, s ^ 0x999);
    if (col.surface === B.SAND) {
      if (roll < col.desert * 0.14) return { x, z, kind: 'cactus', height: 2 + Math.floor(hRoll * 3), base: col.height };
      return null;
    }
    if (col.surface !== B.GRASS) return null;
    const chance = col.forest * 0.78 + col.plains * 0.05;
    if (roll >= chance) return null;
    const pine = col.forest > 0.5 && (col.height > SEA_LEVEL + 13 || hash2(cellX, cellZ, s ^ 0x5151) < 0.3);
    if (pine) return { x, z, kind: 'pine', height: 6 + Math.floor(hRoll * 4), base: col.height };
    return { x, z, kind: 'oak', height: 4 + Math.floor(hRoll * 3), base: col.height };
  }

  private placeTrees(data: Uint8Array, ox: number, oz: number): void {
    const margin = 3;
    const c0x = Math.floor((ox - margin) / TREE_CELL);
    const c1x = Math.floor((ox + CHUNK_SIZE + margin) / TREE_CELL);
    const c0z = Math.floor((oz - margin) / TREE_CELL);
    const c1z = Math.floor((oz + CHUNK_SIZE + margin) / TREE_CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const t = this.treeAt(cx, cz);
        if (!t) continue;
        if (t.x < ox - margin || t.x >= ox + CHUNK_SIZE + margin || t.z < oz - margin || t.z >= oz + CHUNK_SIZE + margin) continue;
        const base = t.base + 1;
        if (t.kind === 'cactus') {
          for (let y = 0; y < t.height; y++) this.set(data, ox, oz, t.x, base + y, t.z, B.CACTUS, true);
          continue;
        }
        if (t.kind === 'oak') {
          const top = base + t.height;
          for (let y = top - 3; y <= top + 1; y++) {
            const r = y >= top ? 1 : 2;
            for (let dz = -r; dz <= r; dz++) {
              for (let dx = -r; dx <= r; dx++) {
                const corner = Math.abs(dx) === r && Math.abs(dz) === r;
                if (corner && (r === 1 ? y === top + 1 : hash2(t.x + dx * 3 + y, t.z + dz, this.seed ^ 0x1eaf) < 0.6)) continue;
                this.set(data, ox, oz, t.x + dx, y, t.z + dz, B.LEAVES, false);
              }
            }
          }
          for (let y = 0; y < t.height; y++) this.set(data, ox, oz, t.x, base + y, t.z, B.TIMBER, true);
          this.set(data, ox, oz, t.x, base - 1, t.z, B.SOIL, true);
        } else {
          const top = base + t.height;
          this.set(data, ox, oz, t.x, top + 1, t.z, B.PINE_NEEDLES, false);
          this.set(data, ox, oz, t.x, top, t.z, B.PINE_NEEDLES, false);
          let layer = 0;
          for (let y = top - 1; y >= base + 2; y--, layer++) {
            const r = layer % 2 === 0 ? Math.min(3, 1 + Math.floor(layer / 2)) : Math.max(1, Math.floor(layer / 2));
            for (let dz = -r; dz <= r; dz++) {
              for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dz * dz > r * r + 1) continue;
                this.set(data, ox, oz, t.x + dx, y, t.z + dz, B.PINE_NEEDLES, false);
              }
            }
          }
          for (let y = 0; y < t.height; y++) this.set(data, ox, oz, t.x, base + y, t.z, B.PINE_TIMBER, true);
          this.set(data, ox, oz, t.x, base - 1, t.z, B.SOIL, true);
        }
      }
    }
  }

  /** "Wardstones": rare rings of mossy pillars around a glowing lantern - a recognisable landmark. */
  landmarkAt(rx: number, rz: number): { x: number; z: number } | null {
    const s = this.seed ^ 0x3a3a;
    if (hash2(rx, rz, s) > 0.4) return null;
    const x = rx * LANDMARK_REGION + 20 + Math.floor(hash2(rx, rz, s ^ 1) * (LANDMARK_REGION - 40));
    const z = rz * LANDMARK_REGION + 20 + Math.floor(hash2(rx, rz, s ^ 2) * (LANDMARK_REGION - 40));
    const col = this.column(x, z);
    if (col.surface !== B.GRASS || col.plains < 0.45 || col.height <= SEA_LEVEL + 2) return null;
    return { x, z };
  }

  private placeLandmarks(data: Uint8Array, ox: number, oz: number): void {
    const R = 7;
    const r0x = Math.floor((ox - 10) / LANDMARK_REGION);
    const r1x = Math.floor((ox + CHUNK_SIZE + 10) / LANDMARK_REGION);
    const r0z = Math.floor((oz - 10) / LANDMARK_REGION);
    const r1z = Math.floor((oz + CHUNK_SIZE + 10) / LANDMARK_REGION);
    for (let rz = r0z; rz <= r1z; rz++) {
      for (let rx = r0x; rx <= r1x; rx++) {
        const lm = this.landmarkAt(rx, rz);
        if (!lm) continue;
        if (Math.abs(lm.x - (ox + 8)) > 18 || Math.abs(lm.z - (oz + 8)) > 18) continue;
        const ch = this.column(lm.x, lm.z).height;
        // Pedestal + lantern in the middle.
        this.set(data, ox, oz, lm.x, ch + 1, lm.z, B.STONE_BRICKS, true);
        this.set(data, ox, oz, lm.x, ch + 2, lm.z, B.LANTERN, true);
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          const px = lm.x + Math.round(Math.cos(ang) * R);
          const pz = lm.z + Math.round(Math.sin(ang) * R);
          const ph = this.column(px, pz).height;
          const tall = 2 + Math.floor(hash2(px, pz, this.seed ^ 0x4d) * 3);
          for (let y = 1; y <= tall; y++) {
            const id = hash2(px + y, pz, this.seed ^ 0x6e) < 0.55 ? B.MOSSY_COBBLE : B.STONE_BRICKS;
            this.set(data, ox, oz, px, ph + y, pz, id, true);
          }
          this.set(data, ox, oz, px, ph, pz, B.MOSSY_COBBLE, true);
        }
      }
    }
  }

  private placePlants(data: Uint8Array, ox: number, oz: number, heights: Int16Array, cols: ColumnInfo[]): void {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const ci = x + z * CHUNK_SIZE;
        const h = heights[ci];
        if (h + 1 >= WORLD_HEIGHT) continue;
        const ground = data[localIndex(x, h, z)];
        const aboveIdx = localIndex(x, h + 1, z);
        if (data[aboveIdx] !== B.AIR) continue;
        const wx = ox + x;
        const wz = oz + z;
        const r = hash2(wx, wz, this.seed ^ 0x9a55);
        const col = cols[ci];
        if (ground === B.GRASS) {
          const grassChance = 0.06 + col.plains * 0.14 + col.forest * 0.08;
          if (r < 0.012 + col.plains * 0.01) data[aboveIdx] = B.EMBERBLOOM;
          else if (r < 0.024 + col.plains * 0.02) data[aboveIdx] = B.SKYBELL;
          else if (r < 0.03 + col.forest * 0.018 + col.plains * 0.02) data[aboveIdx] = col.forest > 0.4 ? B.BERRY_BUSH : B.TALL_GRASS;
          else if (r < 0.03 + grassChance) data[aboveIdx] = B.TALL_GRASS;
        } else if (ground === B.SAND && col.desert > 0.4 && h > SEA_LEVEL + 1) {
          if (r < 0.012) data[aboveIdx] = B.DRY_SHRUB;
        }
      }
    }
  }

  /** Spiral search for a dry, grassy spawn column near the origin. */
  findSpawn(): { x: number; y: number; z: number } {
    let x = 0, z = 0, dx = 0, dz = -1;
    for (let i = 0; i < 4000; i++) {
      const col = this.column(x * 4, z * 4);
      if (col.height > SEA_LEVEL + 1 && col.surface === B.GRASS) {
        return { x: x * 4 + 0.5, y: col.height + 1, z: z * 4 + 0.5 };
      }
      if (x === z || (x < 0 && x === -z) || (x > 0 && x === 1 - z)) {
        const t = dx;
        dx = -dz;
        dz = t;
      }
      x += dx;
      z += dz;
    }
    const col = this.column(0, 0);
    return { x: 0.5, y: Math.max(col.height, SEA_LEVEL) + 1, z: 0.5 };
  }
}
