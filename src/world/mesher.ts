import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/constants';
import { B, BLOCKS, IS_OPAQUE, RENDER_KIND } from './registry';
import { tileUV } from '../render/textures';

/**
 * Chunk mesher: emits only faces exposed to a non-occluding neighbour, merged into one buffer per
 * render class (opaque+cutout, cross plants, water). Per-vertex ambient occlusion and a smoothed
 * sky-exposure term are baked into vertex colours. Greedy merging is intentionally not used:
 * it conflicts with per-vertex AO and atlas tiling, and culled faces already keep a 16x16 chunk at
 * a few thousand quads and exactly one draw call per material.
 */

const PW = CHUNK_SIZE + 2; // padded width
const PLANE = PW * PW;
const H = WORLD_HEIGHT;

const AO_OCC = new Uint8Array(64);
for (let i = 0; i < 64; i++) AO_OCC[i] = IS_OPAQUE[i] || i === B.LEAVES || i === B.PINE_NEEDLES ? 1 : 0;

const AO_CURVE = [0.5, 0.66, 0.82, 1.0];

// Per-block-face tile lookup [id*6 + face] -> tile index. Faces: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z
const FACE_TILE = new Int16Array(64 * 6);
for (const def of BLOCKS) {
  if (!def) continue;
  const t = def.tiles;
  FACE_TILE[def.id * 6 + 0] = t.side;
  FACE_TILE[def.id * 6 + 1] = t.side;
  FACE_TILE[def.id * 6 + 2] = t.top;
  FACE_TILE[def.id * 6 + 3] = t.bottom;
  FACE_TILE[def.id * 6 + 4] = t.front ?? t.side;
  FACE_TILE[def.id * 6 + 5] = t.front ?? t.side;
}

const UV_CACHE: Array<[number, number, number, number]> = [];
const uvOf = (tile: number) => (UV_CACHE[tile] ??= tileUV(tile));

interface FaceDef {
  dir: [number, number, number];
  corners: Array<[number, number, number]>; // BL, BR, TR, TL as seen from outside
  shade: number;
}

const FACES: FaceDef[] = [
  { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.9 },
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.9 },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.7 },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.82 },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.82 },
];

// Precompute, per face and corner, the two tangent offsets used for AO / light sampling.
const TANGENTS: Array<Array<[number, number, number, number, number, number]>> = FACES.map((f) => {
  const axis = f.dir[0] !== 0 ? 0 : f.dir[1] !== 0 ? 1 : 2;
  const others = [0, 1, 2].filter((a) => a !== axis);
  return f.corners.map((c) => {
    const a: [number, number, number] = [0, 0, 0];
    const b: [number, number, number] = [0, 0, 0];
    a[others[0]] = c[others[0]] === 1 ? 1 : -1;
    b[others[1]] = c[others[1]] === 1 ? 1 : -1;
    return [a[0], a[1], a[2], b[0], b[1], b[2]];
  });
});

class Buf {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  idx: Uint32Array;
  vc = 0;
  ic = 0;
  constructor(cap: number) {
    this.pos = new Float32Array(cap * 3);
    this.nor = new Float32Array(cap * 3);
    this.uv = new Float32Array(cap * 2);
    this.col = new Float32Array(cap * 3);
    this.idx = new Uint32Array(cap * 1.5);
  }
  reset(): void {
    this.vc = 0;
    this.ic = 0;
  }
  ensure(extraVerts: number): void {
    const need = this.vc + extraVerts;
    if (need * 3 <= this.pos.length) return;
    const cap = Math.max(need, (this.pos.length / 3) * 2);
    const grow = <A extends Float32Array | Uint32Array>(old: A, n: number): A => {
      const a = new (old.constructor as { new (n: number): A })(n);
      a.set(old);
      return a;
    };
    this.pos = grow(this.pos, cap * 3);
    this.nor = grow(this.nor, cap * 3);
    this.uv = grow(this.uv, cap * 2);
    this.col = grow(this.col, cap * 3);
    this.idx = grow(this.idx, Math.ceil(cap * 1.5));
  }
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: number): void {
    const i3 = this.vc * 3;
    const i2 = this.vc * 2;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.nor[i3] = nx; this.nor[i3 + 1] = ny; this.nor[i3 + 2] = nz;
    this.uv[i2] = u; this.uv[i2 + 1] = v;
    this.col[i3] = c; this.col[i3 + 1] = c; this.col[i3 + 2] = c;
    this.vc++;
  }
  quad(flip: boolean): void {
    const b = this.vc - 4;
    const ix = this.idx;
    let i = this.ic;
    if (!flip) {
      ix[i++] = b; ix[i++] = b + 1; ix[i++] = b + 2;
      ix[i++] = b; ix[i++] = b + 2; ix[i++] = b + 3;
    } else {
      ix[i++] = b + 1; ix[i++] = b + 2; ix[i++] = b + 3;
      ix[i++] = b + 1; ix[i++] = b + 3; ix[i++] = b;
    }
    this.ic = i;
  }
  doubleQuad(): void {
    const b = this.vc - 4;
    const ix = this.idx;
    let i = this.ic;
    ix[i++] = b; ix[i++] = b + 1; ix[i++] = b + 2;
    ix[i++] = b; ix[i++] = b + 2; ix[i++] = b + 3;
    this.ic = i;
  }
  output(): MeshData | null {
    if (this.vc === 0) return null;
    return {
      positions: this.pos.slice(0, this.vc * 3),
      normals: this.nor.slice(0, this.vc * 3),
      uvs: this.uv.slice(0, this.vc * 2),
      colors: this.col.slice(0, this.vc * 3),
      indices: this.idx.slice(0, this.ic),
    };
  }
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export interface ChunkMeshData {
  opaque: MeshData | null;
  cross: MeshData | null;
  water: MeshData | null;
}

const padded = new Uint8Array(PLANE * H);
const heightMap = new Int16Array(PLANE);
const opaqueBuf = new Buf(16384);
const crossBuf = new Buf(2048);
const waterBuf = new Buf(4096);

/**
 * neighbours: 3x3 grid of chunk data arrays indexed [(dz+1)*3 + (dx+1)], centre at index 4.
 */
export function meshChunk(neighbours: Array<Uint8Array | undefined>, topY: number): ChunkMeshData {
  const maxY = Math.min(H, topY + 1);
  // ---- copy into padded volume (only up to maxY+1)
  // Copy the full height so neighbour overhangs feed the sky-light heightmap correctly.
  const copyTop = H;
  padded.fill(0);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const src = neighbours[(dz + 1) * 3 + (dx + 1)];
      if (!src) continue;
      const x0 = dx === -1 ? 15 : 0, x1 = dx === 1 ? 0 : 15;
      const z0 = dz === -1 ? 15 : 0, z1 = dz === 1 ? 0 : 15;
      for (let y = 0; y < copyTop; y++) {
        const sy = y << 8;
        const py = y * PLANE;
        for (let z = z0; z <= z1; z++) {
          const pz = z + 1 + dz * 16;
          const rowSrc = sy + (z << 4);
          const rowDst = py + pz * PW + 1 + dx * 16;
          for (let x = x0; x <= x1; x++) padded[rowDst + x] = src[rowSrc + x];
        }
      }
    }
  }
  // ---- heightmap: top-most fully opaque block per padded column
  for (let i = 0; i < PLANE; i++) {
    let h = -1;
    for (let y = copyTop - 1; y >= 0; y--) {
      if (IS_OPAQUE[padded[y * PLANE + i]]) { h = y; break; }
    }
    heightMap[i] = h;
  }

  opaqueBuf.reset();
  crossBuf.reset();
  waterBuf.reset();

  const skyAt = (px: number, py: number, pz: number): number => {
    const hm = heightMap[px + pz * PW];
    if (py > hm) return 1;
    const depth = hm - py;
    return Math.max(0.18, 0.9 - depth * 0.09);
  };
  const occ = (px: number, py: number, pz: number): number => {
    if (py < 0 || py >= H) return 0;
    return AO_OCC[padded[px + pz * PW + py * PLANE]];
  };
  const opq = (px: number, py: number, pz: number): number => {
    if (py < 0 || py >= H) return py < 0 ? 1 : 0;
    return IS_OPAQUE[padded[px + pz * PW + py * PLANE]];
  };

  const ao = [0, 0, 0, 0];
  const light = [0, 0, 0, 0];

  for (let y = 0; y < maxY; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const px = x + 1, pz = z + 1;
        const id = padded[px + pz * PW + y * PLANE];
        if (id === 0) continue;
        const kind = RENDER_KIND[id];

        if (kind === 3) {
          // Cross plant: two diagonal quads, rendered double-sided.
          const [u0, v0, u1, v1] = uvOf(FACE_TILE[id * 6]);
          const s = skyAt(px, y, pz);
          crossBuf.ensure(8);
          const m = 0.15, n = 0.85;
          crossBuf.vert(x + m, y, z + m, 0, 1, 0, u0, v0, s);
          crossBuf.vert(x + n, y, z + n, 0, 1, 0, u1, v0, s);
          crossBuf.vert(x + n, y + 1, z + n, 0, 1, 0, u1, v1, s);
          crossBuf.vert(x + m, y + 1, z + m, 0, 1, 0, u0, v1, s);
          crossBuf.doubleQuad();
          crossBuf.vert(x + n, y, z + m, 0, 1, 0, u0, v0, s);
          crossBuf.vert(x + m, y, z + n, 0, 1, 0, u1, v0, s);
          crossBuf.vert(x + m, y + 1, z + n, 0, 1, 0, u1, v1, s);
          crossBuf.vert(x + n, y + 1, z + m, 0, 1, 0, u0, v1, s);
          crossBuf.doubleQuad();
          continue;
        }

        if (kind === 4) {
          // Water: surface sits slightly lower when open to air above.
          const above = y + 1 < H ? padded[px + pz * PW + (y + 1) * PLANE] : 0;
          const topH = above === B.WATER ? 1 : 0.875;
          for (let f = 0; f < 6; f++) {
            const fd = FACES[f];
            const nx = px + fd.dir[0], ny = y + fd.dir[1], nz = pz + fd.dir[2];
            if (ny < 0) continue;
            const nid = ny >= H ? 0 : padded[nx + nz * PW + ny * PLANE];
            if (nid === B.WATER || IS_OPAQUE[nid]) continue;
            if (f === 3 && nid !== 0) continue;
            const s = Math.max(0.35, skyAt(nx, ny, nz)) * fd.shade;
            waterBuf.ensure(4);
            for (let c = 0; c < 4; c++) {
              const cr = fd.corners[c];
              const vx = x + cr[0], vy = y + (cr[1] === 1 ? topH : 0), vz = z + cr[2];
              // World-space UVs so the dedicated water texture tiles seamlessly and can scroll.
              const u = f === 0 || f === 1 ? vz : vx;
              const v = f === 2 || f === 3 ? vz : vy;
              waterBuf.vert(vx, vy, vz, fd.dir[0], fd.dir[1], fd.dir[2], u, v, s);
            }
            waterBuf.quad(false);
          }
          continue;
        }

        const cutout = kind === 2;
        for (let f = 0; f < 6; f++) {
          const fd = FACES[f];
          const nx = px + fd.dir[0], ny = y + fd.dir[1], nz = pz + fd.dir[2];
          if (ny < 0) continue;
          const nid = ny >= H ? 0 : padded[nx + nz * PW + ny * PLANE];
          if (IS_OPAQUE[nid]) continue;
          if (cutout && nid === id) continue;
          const tan = TANGENTS[f];
          for (let c = 0; c < 4; c++) {
            const t = tan[c];
            const s1 = occ(nx + t[0], ny + t[1], nz + t[2]);
            const s2 = occ(nx + t[3], ny + t[4], nz + t[5]);
            const cc = occ(nx + t[0] + t[3], ny + t[1] + t[4], nz + t[2] + t[5]);
            ao[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            // Smooth sky light: average the open cells around this vertex.
            let sum = skyAt(nx, ny, nz), cnt = 1;
            if (!opq(nx + t[0], ny + t[1], nz + t[2])) { sum += skyAt(nx + t[0], ny + t[1], nz + t[2]); cnt++; }
            if (!opq(nx + t[3], ny + t[4], nz + t[5])) { sum += skyAt(nx + t[3], ny + t[4], nz + t[5]); cnt++; }
            if (!(s1 && s2) && !opq(nx + t[0] + t[3], ny + t[1] + t[4], nz + t[2] + t[5])) {
              sum += skyAt(nx + t[0] + t[3], ny + t[1] + t[4], nz + t[2] + t[5]);
              cnt++;
            }
            light[c] = sum / cnt;
          }
          const [u0, v0, u1, v1] = uvOf(FACE_TILE[id * 6 + f]);
          opaqueBuf.ensure(4);
          const cr = fd.corners;
          const sh = fd.shade;
          opaqueBuf.vert(x + cr[0][0], y + cr[0][1], z + cr[0][2], fd.dir[0], fd.dir[1], fd.dir[2], u0, v0, AO_CURVE[ao[0]] * light[0] * sh);
          opaqueBuf.vert(x + cr[1][0], y + cr[1][1], z + cr[1][2], fd.dir[0], fd.dir[1], fd.dir[2], u1, v0, AO_CURVE[ao[1]] * light[1] * sh);
          opaqueBuf.vert(x + cr[2][0], y + cr[2][1], z + cr[2][2], fd.dir[0], fd.dir[1], fd.dir[2], u1, v1, AO_CURVE[ao[2]] * light[2] * sh);
          opaqueBuf.vert(x + cr[3][0], y + cr[3][1], z + cr[3][2], fd.dir[0], fd.dir[1], fd.dir[2], u0, v1, AO_CURVE[ao[3]] * light[3] * sh);
          // Flip the diagonal when AO is anisotropic so gradients stay smooth.
          opaqueBuf.quad(ao[0] + ao[2] < ao[1] + ao[3]);
        }
      }
    }
  }

  return { opaque: opaqueBuf.output(), cross: crossBuf.output(), water: waterBuf.output() };
}
