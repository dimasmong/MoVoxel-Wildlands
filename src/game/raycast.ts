import type { World } from '../world/world';
import { RENDER_KIND } from '../world/registry';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  /** Face normal of the hit (the adjacent cell is x+nx etc.). */
  nx: number;
  ny: number;
  nz: number;
  id: number;
  distance: number;
}

/**
 * Amanatides & Woo voxel traversal. Visits every cell the ray passes through in order, so the
 * first targetable block is exactly what sits under the crosshair.
 */
export function raycastVoxel(
  world: World,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
): RayHit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    // Everything except air and water can be targeted (plants included).
    if (id > 0 && RENDER_KIND[id] !== 4 && RENDER_KIND[id] !== 0) {
      return { x, y, z, nx, ny, nz, id, distance: t };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}
