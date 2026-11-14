/**
 * World coordinate conventions
 * - +Y is up. One block = one world unit. Block (x,y,z) occupies [x,x+1) x [y,y+1) x [z,z+1).
 * - Chunks are CHUNK_SIZE x WORLD_HEIGHT x CHUNK_SIZE columns, addressed by (cx, cz).
 * - Local index inside a chunk: x + z * 16 + y * 256 (y-major so a vertical column is a stride walk).
 */
export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const CHUNK_MASK = 15;
export const WORLD_HEIGHT = 128;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * WORLD_HEIGHT;
export const SEA_LEVEL = 34;

export const TICK_RATE = 60;
export const FIXED_DT = 1 / TICK_RATE;

export const DAY_LENGTH_SECONDS = 20 * 60; // full day/night cycle in real seconds

export const SAVE_VERSION = 1;
export const GENERATOR_VERSION = 1;

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;
export const localIndex = (x: number, y: number, z: number): number => x + (z << 4) + (y << 8);
