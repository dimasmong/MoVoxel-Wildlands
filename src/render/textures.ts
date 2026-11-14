import { mulberry32 } from '../core/rng';
import { T } from '../world/registry';

/**
 * Original procedural pixel art. Every tile is painted from a seeded RNG into a 16x16 cell of a
 * 256x256 atlas, so the art is deterministic, crisp and owned by this project.
 */
export const TILE = 16;
export const ATLAS_TILES = 16;
export const ATLAS_SIZE = TILE * ATLAS_TILES;

type RGB = [number, number, number];

class Painter {
  readonly img: ImageData;
  constructor(readonly size: number) {
    this.img = new ImageData(size, size);
  }
  set(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    const d = this.img.data;
    d[i] = Math.max(0, Math.min(255, c[0]));
    d[i + 1] = Math.max(0, Math.min(255, c[1]));
    d[i + 2] = Math.max(0, Math.min(255, c[2]));
    d[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const i = (y * this.size + x) * 4;
    const d = this.img.data;
    return [d[i], d[i + 1], d[i + 2]];
  }
  alpha(x: number, y: number): number {
    return this.img.data[(y * this.size + x) * 4 + 3];
  }
  fill(c: RGB, jitter: number, rand: () => number): void {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) this.set(x, y, shade(c, (rand() - 0.5) * jitter));
  }
}

const shade = (c: RGB, amt: number): RGB => [c[0] + amt, c[1] + amt, c[2] + amt];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const pick = <V>(rand: () => number, arr: V[]): V => arr[Math.floor(rand() * arr.length)];

// ---------------------------------------------------------------- palettes
const P = {
  grass: [[92, 158, 62], [104, 170, 66], [82, 144, 58], [116, 178, 74], [74, 132, 54]] as RGB[],
  soil: [[122, 86, 58], [110, 77, 52], [134, 96, 64], [100, 70, 48]] as RGB[],
  slate: [124, 128, 138] as RGB,
  sand: [[222, 202, 146], [214, 192, 136], [230, 212, 158], [206, 184, 128]] as RGB[],
  bark: [[106, 76, 48], [92, 66, 42], [118, 86, 54], [80, 58, 38]] as RGB[],
  plank: [178, 134, 84] as RGB,
  leaf: [[62, 124, 50], [74, 140, 56], [52, 108, 44], [88, 152, 62]] as RGB[],
  pine: [[40, 92, 66], [48, 104, 72], [34, 80, 58], [58, 114, 78]] as RGB[],
  water: [52, 112, 196] as RGB,
};

function paintGrassTop(p: Painter, r: () => number): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, pick(r, P.grass));
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(r() * 16), y = Math.floor(r() * 15);
    p.set(x, y, [132, 192, 84]);
    p.set(x, y + 1, [70, 128, 50]);
  }
  for (let i = 0; i < 2; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), [206, 196, 96]);
}

function paintSoil(p: Painter, r: () => number): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, pick(r, P.soil));
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
    p.set(x, y, [146, 132, 116]);
    if (r() < 0.5) p.set(x + 1, y, [120, 108, 96]);
  }
  for (let i = 0; i < 5; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), [84, 58, 40]);
}

function paintGrassSide(p: Painter, r: () => number): void {
  paintSoil(p, r);
  for (let x = 0; x < 16; x++) {
    const depth = 3 + Math.floor(r() * 3) + (x % 5 === 2 ? 1 : 0);
    for (let y = 0; y < depth; y++) p.set(x, y, pick(r, P.grass));
    p.set(x, depth, [70, 112, 46]);
  }
}

function paintSlate(p: Painter, r: () => number, base: RGB = P.slate): void {
  p.fill(base, 14, r);
  // Horizontal strata give slate its own identity (not a generic speckled stone).
  for (let band = 0; band < 4; band++) {
    let y = 2 + band * 4 + Math.floor(r() * 2);
    for (let x = 0; x < 16; x++) {
      if (r() < 0.18) y += r() < 0.5 ? -1 : 1;
      y = Math.max(0, Math.min(15, y));
      p.set(x, y, shade(base, -26 + r() * 6));
      if (r() < 0.25) p.set(x, y - 1, shade(base, 14));
    }
  }
}

function paintSand(p: Painter, r: () => number): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, pick(r, P.sand));
  for (let i = 0; i < 7; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), [186, 162, 112]);
  for (let i = 0; i < 4; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), [244, 232, 190]);
}

function paintBark(p: Painter, r: () => number, pal: RGB[] = P.bark): void {
  for (let x = 0; x < 16; x++) {
    const col = pick(r, pal);
    for (let y = 0; y < 16; y++) p.set(x, y, shade(col, (r() - 0.5) * 10));
  }
  for (let g = 0; g < 4; g++) {
    let x = Math.floor(r() * 16);
    for (let y = 0; y < 16; y++) {
      if (r() < 0.2) x += r() < 0.5 ? -1 : 1;
      p.set((x + 16) % 16, y, shade(pal[3], -14));
    }
  }
}

function paintPineBark(p: Painter, r: () => number): void {
  const pal: RGB[] = [[96, 62, 44], [84, 54, 38], [108, 70, 48], [70, 44, 32]];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, shade(pick(r, pal), 0));
  for (let row = 1; row < 16; row += 3 + Math.floor(r() * 2)) {
    const start = Math.floor(r() * 16), len = 3 + Math.floor(r() * 6);
    for (let i = 0; i < len; i++) p.set((start + i) % 16, row, [58, 36, 26]);
  }
}

function paintRings(p: Painter, r: () => number, bark: RGB, inner: RGB, ring: RGB): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 6.6) p.set(x, y, shade(bark, (r() - 0.5) * 14));
      else if (Math.floor(d + r() * 0.4) % 2 === 0) p.set(x, y, shade(ring, (r() - 0.5) * 8));
      else p.set(x, y, shade(inner, (r() - 0.5) * 8));
    }
  }
}

function paintPlanks(p: Painter, r: () => number): void {
  for (let row = 0; row < 4; row++) {
    const tone = shade(P.plank, (r() - 0.5) * 22);
    const seam = Math.floor(r() * 12) + 2;
    for (let y = row * 4; y < row * 4 + 4; y++) {
      for (let x = 0; x < 16; x++) {
        let c = shade(tone, (r() - 0.5) * 10);
        if (r() < 0.12) c = shade(c, -14); // grain
        if (y === row * 4 + 3) c = shade(tone, -46);
        if (x === seam && y !== row * 4 + 3) c = shade(tone, -38);
        p.set(x, y, c);
      }
    }
    p.set((seam + 2) % 16, row * 4 + 1, shade(tone, -60));
  }
}

function paintFoliage(p: Painter, r: () => number, pal: RGB[], holes: number): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (r() < holes) {
        p.set(x, y, [0, 0, 0], 0);
        continue;
      }
      p.set(x, y, pick(r, pal));
    }
  }
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
    if (p.alpha(x, y) === 0) continue;
    p.set(x, y, shade(pal[3], 20));
    p.set(x + 1, y + 1, shade(pal[2], -18));
  }
}

function paintWater(p: Painter, r: () => number): void {
  p.fill(P.water, 8, r);
  for (let w = 0; w < 5; w++) {
    const y = Math.floor(r() * 16), x0 = Math.floor(r() * 16), len = 3 + Math.floor(r() * 5);
    for (let i = 0; i < len; i++) p.set((x0 + i) % 16, y, [112, 168, 228]);
    p.set((x0 + len) % 16, (y + 1) % 16, [36, 92, 172]);
  }
}

function paintOre(p: Painter, r: () => number, dark: RGB, light: RGB, glint: RGB, blobs: number): void {
  paintSlate(p, r);
  for (let b = 0; b < blobs; b++) {
    const cx = 2 + Math.floor(r() * 12), cy = 2 + Math.floor(r() * 12);
    const cells: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]];
    for (const [dx, dy] of cells) {
      if (r() < 0.25) continue;
      p.set(cx + dx, cy + dy, r() < 0.5 ? dark : light);
    }
    p.set(cx, cy, glint);
  }
}

function paintCobble(p: Painter, r: () => number, base: RGB, moss = false): void {
  const centers: Array<[number, number, number]> = [];
  for (let i = 0; i < 8; i++) centers.push([r() * 16, r() * 16, (r() - 0.5) * 30]);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let i = 0; i < centers.length; i++) {
        for (const ox of [-16, 0, 16]) for (const oy of [-16, 0, 16]) {
          const dx = x + 0.5 - (centers[i][0] + ox), dy = y + 0.5 - (centers[i][1] + oy);
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1) < 1.1;
      let c = edge ? shade(base, -44) : shade(base, centers[best][2] + (r() - 0.5) * 10);
      if (!edge && Math.sqrt(d1) < 1.6) c = shade(c, 12);
      p.set(x, y, c);
    }
  }
  if (moss) {
    for (let i = 0; i < 5; i++) {
      let x = Math.floor(r() * 16), y = Math.floor(r() * 16);
      for (let s = 0; s < 9; s++) {
        p.set(x, y, pick(r, P.grass));
        x = (x + (r() < 0.5 ? 1 : -1) + 16) % 16;
        if (r() < 0.5) y = (y + 1) % 16;
      }
    }
  }
}

function paintSandstoneSide(p: Painter, r: () => number): void {
  paintSand(p, r);
  for (let x = 0; x < 16; x++) {
    p.set(x, 0, [236, 220, 170]);
    p.set(x, 4, [196, 172, 118]);
    p.set(x, 10, [190, 166, 114]);
    p.set(x, 15, [180, 156, 104]);
    if (x % 4 === 1) p.set(x, 7, [200, 176, 124]);
  }
}

function paintSandstoneTop(p: Painter, r: () => number): void {
  paintSand(p, r);
  for (let i = 0; i < 16; i++) {
    p.set(i, 0, [194, 170, 116]); p.set(i, 15, [194, 170, 116]);
    p.set(0, i, [194, 170, 116]); p.set(15, i, [194, 170, 116]);
  }
}

function paintGlass(p: Painter, r: () => number): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, [0, 0, 0], 0);
  const frame: RGB = [196, 222, 230];
  for (let i = 0; i < 16; i++) {
    p.set(i, 0, frame); p.set(i, 15, shade(frame, -40));
    p.set(0, i, frame); p.set(15, i, shade(frame, -40));
  }
  for (let i = 0; i < 4; i++) p.set(3 + i, 3 + i, [236, 248, 252], 220);
  p.set(11, 4, [236, 248, 252], 200);
  p.set(12, 3, [236, 248, 252], 200);
  void r;
}

function paintBenchTop(p: Painter, r: () => number): void {
  paintPlanks(p, r);
  const iron: RGB = [86, 90, 98];
  for (let i = 1; i < 15; i++) {
    p.set(i, 1, shade(P.plank, -55)); p.set(i, 14, shade(P.plank, -55));
    p.set(1, i, shade(P.plank, -55)); p.set(14, i, shade(P.plank, -55));
  }
  for (let i = 4; i < 12; i++) { p.set(i, 7, iron); p.set(7, i, iron); }
  p.set(4, 4, [190, 110, 60]); p.set(11, 11, [190, 110, 60]);
}

function paintBenchSide(p: Painter, r: () => number, front: boolean): void {
  paintPlanks(p, r);
  const dark: RGB = [92, 64, 40];
  for (let x = 0; x < 16; x++) { p.set(x, 0, dark); p.set(x, 1, [120, 84, 52]); }
  for (let y = 0; y < 16; y++) { p.set(0, y, dark); p.set(15, y, dark); }
  if (front) {
    // Saw and hammer silhouettes hung on the bench front.
    for (let i = 0; i < 6; i++) { p.set(3 + i, 5, [170, 176, 186]); p.set(3 + i, 6, [140, 146, 156]); }
    for (let i = 3; i < 9; i += 2) p.set(i, 7, [110, 116, 126]);
    p.set(2, 5, [90, 60, 36]); p.set(2, 6, [90, 60, 36]);
    for (let y = 4; y < 12; y++) p.set(11, y, [96, 66, 40]);
    for (let x = 9; x < 14; x++) { p.set(x, 4, [96, 100, 110]); p.set(x, 5, [80, 84, 94]); }
  } else {
    for (let x = 4; x < 12; x++) { p.set(x, 8, dark); p.set(x, 12, dark); }
    for (let y = 8; y < 13; y++) { p.set(4, y, dark); p.set(11, y, dark); }
    p.set(7, 10, [200, 170, 90]); p.set(8, 10, [200, 170, 90]);
  }
}

function paintBricks(p: Painter, r: () => number): void {
  const base: RGB = [128, 132, 142];
  for (let y = 0; y < 16; y++) {
    const row = Math.floor(y / 4);
    const offset = row % 2 === 0 ? 0 : 4;
    for (let x = 0; x < 16; x++) {
      const mortar = y % 4 === 3 || (x + offset) % 8 === 7;
      p.set(x, y, mortar ? [86, 88, 96] : shade(base, (r() - 0.5) * 14 + (y % 4 === 0 ? 10 : 0)));
    }
  }
}

function clear(p: Painter): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, [0, 0, 0], 0);
}

function paintTallGrass(p: Painter, r: () => number): void {
  clear(p);
  for (let b = 0; b < 9; b++) {
    let x = 1 + Math.floor(r() * 14);
    const h = 5 + Math.floor(r() * 9);
    const lean = r() < 0.5 ? -1 : 1;
    for (let i = 0; i < h; i++) {
      if (i > h * 0.6 && r() < 0.4) x += lean;
      p.set(x, 15 - i, i > h - 3 ? [126, 186, 78] : pick(r, P.grass));
    }
  }
}

function paintFlower(p: Painter, r: () => number, petal: RGB, center: RGB, bell: boolean): void {
  clear(p);
  const stem: RGB = [70, 130, 52];
  for (let y = 7; y < 16; y++) p.set(7 + (y > 12 ? 1 : 0), y, stem);
  p.set(6, 11, stem); p.set(5, 10, stem); p.set(9, 13, stem); p.set(10, 12, stem);
  if (bell) {
    for (const [x, y] of [[6, 4], [7, 4], [8, 4], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [5, 6], [9, 6], [6, 6], [8, 6]] as Array<[number, number]>)
      p.set(x, y, shade(petal, (r() - 0.5) * 20));
    p.set(7, 6, center); p.set(7, 3, stem);
  } else {
    for (const [x, y] of [[7, 2], [6, 3], [8, 3], [5, 4], [9, 4], [6, 5], [8, 5], [7, 6], [5, 3], [9, 3]] as Array<[number, number]>)
      p.set(x, y, shade(petal, (r() - 0.5) * 24));
    p.set(7, 4, center); p.set(7, 3, shade(center, 30)); p.set(6, 4, shade(petal, -20)); p.set(8, 4, shade(petal, -20));
  }
}

function paintCactusSide(p: Painter, r: () => number): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const rib = x % 4 === 1;
      p.set(x, y, rib ? [96, 156, 70] : shade([66, 128, 58], (r() - 0.5) * 12));
    }
  }
  for (let i = 0; i < 10; i++) p.set(Math.floor(r() * 4) * 4 + 1, Math.floor(r() * 16), [232, 226, 180]);
  for (let y = 0; y < 16; y++) { p.set(0, y, [46, 96, 44]); p.set(15, y, [46, 96, 44]); }
}

function paintCactusTop(p: Painter, r: () => number): void {
  paintRings(p, r, [46, 96, 44], [96, 156, 70], [76, 138, 60]);
  p.set(7, 7, [236, 140, 170]); p.set(8, 8, [236, 140, 170]); p.set(8, 7, [250, 200, 120]);
}

function paintDeepstone(p: Painter, r: () => number): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, pick(r, [[44, 42, 52], [36, 34, 44], [58, 56, 66], [28, 26, 34]] as RGB[]));
  for (let i = 0; i < 4; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), [92, 70, 120]);
}

function paintBerryBush(p: Painter, r: () => number): void {
  clear(p);
  for (let y = 3; y < 16; y++) {
    const half = Math.min(7, Math.floor((y - 2) * 0.9) + 2);
    for (let x = 8 - half; x < 8 + half; x++) if (r() > 0.2) p.set(x, y, pick(r, P.leaf));
  }
  for (let i = 0; i < 7; i++) {
    const x = 3 + Math.floor(r() * 10), y = 5 + Math.floor(r() * 9);
    p.set(x, y, [96, 52, 140]); p.set(x + 1, y, [126, 76, 176]); p.set(x, y + 1, [70, 36, 104]);
  }
}

function paintLantern(p: Painter, r: () => number): void {
  const frame: RGB = [70, 52, 36];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const border = x < 2 || x > 13 || y < 2 || y > 13;
      const bar = x === 7 || x === 8 || y === 7 || y === 8;
      if (border) p.set(x, y, shade(frame, (r() - 0.5) * 12));
      else if (bar) p.set(x, y, [96, 74, 50]);
      else {
        const dx = x - 7.5, dy = y - 7.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        p.set(x, y, mix([255, 246, 196], [120, 220, 236], Math.min(1, d / 7)));
      }
    }
  }
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]] as Array<[number, number]>) p.set(x, y, [170, 150, 90]);
}

function paintDryShrub(p: Painter, r: () => number): void {
  clear(p);
  const twig: RGB[] = [[130, 98, 60], [112, 82, 50], [150, 116, 72]];
  for (let b = 0; b < 6; b++) {
    let x = 7 + Math.floor((r() - 0.5) * 4);
    let y = 15;
    const dx = r() < 0.5 ? -1 : 1;
    for (let i = 0; i < 9; i++) {
      p.set(x, y, pick(r, twig));
      y--;
      if (r() < 0.55) x += dx;
    }
  }
}

const PAINTERS: Record<number, (p: Painter, r: () => number) => void> = {
  [T.GRASS_TOP]: paintGrassTop,
  [T.GRASS_SIDE]: paintGrassSide,
  [T.SOIL]: paintSoil,
  [T.STONE]: (p, r) => paintSlate(p, r),
  [T.SAND]: paintSand,
  [T.TIMBER_SIDE]: (p, r) => paintBark(p, r),
  [T.TIMBER_TOP]: (p, r) => paintRings(p, r, [96, 70, 44], [190, 152, 98], [158, 120, 76]),
  [T.PLANKS]: paintPlanks,
  [T.LEAVES]: (p, r) => paintFoliage(p, r, P.leaf, 0.14),
  [T.WATER]: paintWater,
  [T.COAL_ORE]: (p, r) => paintOre(p, r, [34, 30, 32], [52, 46, 46], [236, 120, 48], 5),
  [T.COPPER_ORE]: (p, r) => paintOre(p, r, [176, 96, 52], [210, 132, 72], [92, 176, 150], 5),
  [T.CRYSTAL_ORE]: (p, r) => paintOre(p, r, [96, 210, 230], [170, 120, 236], [236, 252, 255], 4),
  [T.COBBLE]: (p, r) => paintCobble(p, r, [128, 130, 138]),
  [T.SANDSTONE_SIDE]: paintSandstoneSide,
  [T.SANDSTONE_TOP]: paintSandstoneTop,
  [T.GLASS]: paintGlass,
  [T.BENCH_TOP]: paintBenchTop,
  [T.BENCH_SIDE]: (p, r) => paintBenchSide(p, r, false),
  [T.BENCH_FRONT]: (p, r) => paintBenchSide(p, r, true),
  [T.STONE_BRICKS]: paintBricks,
  [T.TALL_GRASS]: paintTallGrass,
  [T.EMBERBLOOM]: (p, r) => paintFlower(p, r, [232, 92, 52], [255, 214, 90], false),
  [T.SKYBELL]: (p, r) => paintFlower(p, r, [92, 140, 236], [236, 240, 255], true),
  [T.CACTUS_SIDE]: paintCactusSide,
  [T.CACTUS_TOP]: paintCactusTop,
  [T.DEEPSTONE]: paintDeepstone,
  [T.BERRY_BUSH]: paintBerryBush,
  [T.MOSSY_COBBLE]: (p, r) => paintCobble(p, r, [120, 124, 128], true),
  [T.PINE_NEEDLES]: (p, r) => paintFoliage(p, r, P.pine, 0.18),
  [T.LANTERN]: paintLantern,
  [T.DRY_SHRUB]: paintDryShrub,
  [T.PINE_SIDE]: paintPineBark,
  [T.PINE_TOP]: (p, r) => paintRings(p, r, [80, 50, 36], [176, 130, 88], [140, 100, 66]),
};

/** Tiles with glowing pixels; their bright pixels are copied into the emissive atlas. */
const EMISSIVE_TILES = new Set<number>([T.LANTERN, T.CRYSTAL_ORE]);

export interface AtlasCanvases {
  color: HTMLCanvasElement;
  emissive: HTMLCanvasElement;
  tiles: ImageData[];
}

let cached: AtlasCanvases | null = null;

export function buildAtlas(): AtlasCanvases {
  if (cached) return cached;
  const color = document.createElement('canvas');
  color.width = color.height = ATLAS_SIZE;
  const emissive = document.createElement('canvas');
  emissive.width = emissive.height = ATLAS_SIZE;
  const cctx = color.getContext('2d')!;
  const ectx = emissive.getContext('2d')!;
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const tiles: ImageData[] = [];
  for (let t = 0; t < T.COUNT; t++) {
    const p = new Painter(TILE);
    const paint = PAINTERS[t];
    if (paint) paint(p, mulberry32(0xa11ce + t * 7919));
    tiles[t] = p.img;
    const tx = (t % ATLAS_TILES) * TILE;
    const ty = Math.floor(t / ATLAS_TILES) * TILE;
    cctx.putImageData(p.img, tx, ty);
    if (EMISSIVE_TILES.has(t)) {
      const e = new Painter(TILE);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const [r, g, b] = p.get(x, y);
          const lum = (r + g + b) / 3;
          const glow = t === T.LANTERN ? lum > 120 : lum > 200 || (b > 200 && r < 200);
          e.set(x, y, glow ? [r, g, b] : [0, 0, 0]);
        }
      }
      ectx.putImageData(e.img, tx, ty);
    }
  }
  cached = { color, emissive, tiles };
  return cached;
}

/** UV rectangle of a tile, inset by a tiny epsilon to avoid sampling neighbours. */
export function tileUV(tile: number): [number, number, number, number] {
  const eps = 0.02 / ATLAS_SIZE;
  const u0 = ((tile % ATLAS_TILES) * TILE) / ATLAS_SIZE + eps;
  const v1 = 1 - (Math.floor(tile / ATLAS_TILES) * TILE) / ATLAS_SIZE - eps;
  const u1 = u0 + TILE / ATLAS_SIZE - 2 * eps;
  const v0 = v1 - TILE / ATLAS_SIZE + 2 * eps;
  return [u0, v0, u1, v1];
}

export function tileCanvas(tile: number): HTMLCanvasElement {
  const { tiles } = buildAtlas();
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  c.getContext('2d')!.putImageData(tiles[tile], 0, 0);
  return c;
}

/** Eight crack stages for the mining overlay. */
export function buildCrackCanvases(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  const rand = mulberry32(0xc7ac);
  const lines: Array<Array<[number, number]>> = [];
  for (let l = 0; l < 10; l++) {
    let x = 4 + rand() * 8, y = 4 + rand() * 8;
    const pts: Array<[number, number]> = [];
    const ang = rand() * Math.PI * 2;
    for (let s = 0; s < 9; s++) {
      pts.push([Math.floor(x), Math.floor(y)]);
      x += Math.cos(ang + (rand() - 0.5) * 1.6) * 1.2;
      y += Math.sin(ang + (rand() - 0.5) * 1.6) * 1.2;
    }
    lines.push(pts);
  }
  for (let stage = 0; stage < 8; stage++) {
    const p = new Painter(TILE);
    clear(p);
    const nLines = 1 + Math.floor((stage / 7) * 9);
    const len = 3 + Math.floor((stage / 7) * 6);
    for (let l = 0; l < nLines; l++) {
      for (let s = 0; s < Math.min(len, lines[l].length); s++) {
        const [x, y] = lines[l][s];
        p.set(x, y, [20, 16, 14], 200);
      }
    }
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    c.getContext('2d')!.putImageData(p.img, 0, 0);
    out.push(c);
  }
  return out;
}

export { Painter, shade, mix };
export type { RGB };
