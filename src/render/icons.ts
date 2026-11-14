import { BLOCKS, I, RENDER_KIND, isBlockItem } from '../world/registry';
import { Painter, buildAtlas, tileCanvas, type RGB } from './textures';

/** Item and block icons for the UI and held-item sprites. All original pixel art. */

type Px = Array<[number, number]>;

const line = (x0: number, y0: number, x1: number, y1: number): Px => {
  const out: Px = [];
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) out.push([Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n)]);
  return out;
};

function drawPx(p: Painter, pts: Px, c: RGB, outline?: RGB): void {
  if (outline) for (const [x, y] of pts) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (p.alpha(x + dx, y + dy) === 0) p.set(x + dx, y + dy, outline);
  for (const [x, y] of pts) p.set(x, y, c);
}

const MATERIAL: Record<string, { head: RGB; hi: RGB; lo: RGB }> = {
  wood: { head: [176, 132, 82], hi: [206, 164, 108], lo: [120, 86, 52] },
  stone: { head: [130, 134, 144], hi: [170, 174, 182], lo: [88, 92, 100] },
  copper: { head: [210, 128, 70], hi: [240, 174, 110], lo: [140, 78, 44] },
};

function paintTool(p: Painter, kind: 'pickaxe' | 'axe' | 'shovel', mat: keyof typeof MATERIAL): void {
  const m = MATERIAL[mat];
  const handle = line(3, 13, 11, 5);
  drawPx(p, handle, [120, 84, 50], [40, 28, 20]);
  for (const [x, y] of handle.slice(0, 4)) p.set(x, y, [96, 66, 40]);
  let head: Px = [];
  if (kind === 'pickaxe') head = [...line(5, 3, 9, 2), ...line(9, 2, 12, 4), ...line(12, 4, 13, 7), ...line(13, 7, 14, 11), ...line(5, 3, 4, 4), ...line(10, 3, 12, 5)];
  else if (kind === 'axe') head = [...line(9, 2, 12, 2), ...line(8, 3, 13, 3), ...line(8, 4, 14, 4), ...line(9, 5, 14, 5), ...line(10, 6, 13, 6), ...line(11, 7, 12, 7)];
  else head = [...line(10, 2, 13, 2), ...line(10, 3, 14, 3), ...line(10, 4, 14, 4), ...line(11, 5, 14, 5), ...line(12, 6, 13, 6)];
  drawPx(p, head, m.head, [40, 32, 30]);
  for (const [x, y] of head) if (y <= 3) p.set(x, y, m.hi);
  for (const [x, y] of head) if (y >= 6) p.set(x, y, m.lo);
}

function paintItem(id: number, p: Painter): void {
  switch (id) {
    case I.STICK:
      drawPx(p, line(3, 13, 12, 3), [140, 100, 60], [52, 36, 24]);
      drawPx(p, line(4, 13, 12, 4), [110, 78, 46]);
      break;
    case I.COAL: {
      const pts: Px = [];
      for (let y = 4; y < 13; y++) for (let x = 3; x < 13; x++) if ((x - 7.5) ** 2 / 25 + (y - 8.5) ** 2 / 18 < 1) pts.push([x, y]);
      drawPx(p, pts, [40, 36, 38], [16, 14, 16]);
      for (const [x, y] of [[6, 6], [9, 8], [7, 10]] as Px) p.set(x, y, [236, 120, 48]);
      p.set(5, 5, [92, 86, 90]);
      break;
    }
    case I.COPPER: {
      const pts: Px = [];
      for (let y = 5; y < 13; y++) for (let x = 3; x < 14; x++) if (Math.abs(x - 8) + Math.abs(y - 9) * 1.3 < 6) pts.push([x, y]);
      drawPx(p, pts, [210, 128, 70], [90, 48, 28]);
      for (const [x, y] of [[6, 7], [7, 7], [6, 8]] as Px) p.set(x, y, [246, 186, 120]);
      for (const [x, y] of [[10, 10], [9, 11]] as Px) p.set(x, y, [92, 176, 150]);
      break;
    }
    case I.CRYSTAL: {
      const pts: Px = [...line(8, 2, 8, 13), ...line(7, 4, 7, 12), ...line(9, 4, 9, 12), ...line(6, 6, 6, 11), ...line(10, 6, 10, 11)];
      drawPx(p, pts, [110, 214, 236], [40, 70, 110]);
      for (const [x, y] of line(7, 5, 7, 9)) p.set(x, y, [236, 252, 255]);
      for (const [x, y] of line(10, 8, 10, 11)) p.set(x, y, [170, 120, 236]);
      break;
    }
    case I.BERRIES: {
      drawPx(p, line(8, 2, 9, 5), [70, 130, 52]);
      drawPx(p, [[10, 3], [11, 3], [11, 4]], [92, 158, 62]);
      for (const [cx, cy] of [[6, 8], [10, 8], [8, 11], [5, 12], [11, 12]] as Px) {
        const pts: Px = [[cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1], [cx - 1, cy], [cx, cy - 1]];
        drawPx(p, pts, [104, 58, 150], [40, 20, 60]);
        p.set(cx, cy - 1, [160, 120, 210]);
      }
      break;
    }
    case I.HAUNCH: {
      const meat: Px = [];
      for (let y = 3; y < 11; y++) for (let x = 5; x < 14; x++) if ((x - 9.5) ** 2 / 16 + (y - 6.5) ** 2 / 12 < 1) meat.push([x, y]);
      drawPx(p, meat, [186, 92, 72], [70, 30, 24]);
      for (const [x, y] of [[8, 4], [9, 4], [7, 5]] as Px) p.set(x, y, [226, 150, 120]);
      drawPx(p, line(6, 10, 3, 13), [236, 228, 210], [90, 80, 70]);
      drawPx(p, [[2, 13], [3, 14], [2, 12]], [236, 228, 210]);
      break;
    }
    case I.WOOD_PICKAXE: paintTool(p, 'pickaxe', 'wood'); break;
    case I.WOOD_AXE: paintTool(p, 'axe', 'wood'); break;
    case I.WOOD_SHOVEL: paintTool(p, 'shovel', 'wood'); break;
    case I.STONE_PICKAXE: paintTool(p, 'pickaxe', 'stone'); break;
    case I.STONE_AXE: paintTool(p, 'axe', 'stone'); break;
    case I.STONE_SHOVEL: paintTool(p, 'shovel', 'stone'); break;
    case I.COPPER_PICKAXE: paintTool(p, 'pickaxe', 'copper'); break;
    case I.COPPER_AXE: paintTool(p, 'axe', 'copper'); break;
    case I.COPPER_SHOVEL: paintTool(p, 'shovel', 'copper'); break;
  }
}

const canvasCache = new Map<number, HTMLCanvasElement>();
const urlCache = new Map<number, string>();

/** 16x16 flat sprite for an item, or the face tile for cross-plants. */
export function itemSpriteCanvas(id: number): HTMLCanvasElement {
  const cached = canvasCache.get(id);
  if (cached) return cached;
  let c: HTMLCanvasElement;
  if (isBlockItem(id)) {
    c = tileCanvas(BLOCKS[id].tiles.side);
  } else {
    const p = new Painter(16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, [0, 0, 0], 0);
    paintItem(id, p);
    c = document.createElement('canvas');
    c.width = c.height = 16;
    c.getContext('2d')!.putImageData(p.img, 0, 0);
  }
  canvasCache.set(id, c);
  return c;
}

function isoBlockIcon(id: number): HTMLCanvasElement {
  const def = BLOCKS[id];
  buildAtlas();
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const top = tileCanvas(def.tiles.top);
  const side = tileCanvas(def.tiles.front ?? def.tiles.side);
  const side2 = tileCanvas(def.tiles.side);
  // Top face
  ctx.setTransform(1, 0.5, -1, 0.5, 16, 0);
  ctx.drawImage(top, 0, 0);
  // Left face
  ctx.setTransform(1, 0.5, 0, 1, 0, 8);
  ctx.drawImage(side, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillRect(0, 0, 16, 16);
  ctx.globalCompositeOperation = 'source-over';
  // Right face
  ctx.setTransform(1, -0.5, 0, 1, 16, 16);
  ctx.drawImage(side2, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(0, 0, 16, 16);
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

export function iconURL(id: number): string {
  const cached = urlCache.get(id);
  if (cached) return cached;
  let c: HTMLCanvasElement;
  if (isBlockItem(id) && RENDER_KIND[id] !== 3) c = isoBlockIcon(id);
  else {
    c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(itemSpriteCanvas(id), 0, 0, 32, 32);
  }
  const url = c.toDataURL();
  urlCache.set(id, url);
  return url;
}
