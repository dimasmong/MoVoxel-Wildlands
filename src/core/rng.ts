/** Deterministic hashing and PRNG utilities. We own these so seeds stay stable across browsers. */

export function hashString(str: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Converts a user seed string into a 32-bit integer. Numeric strings map to themselves. */
export function seedFromInput(input: string): number {
  const trimmed = input.trim();
  if (trimmed === '') return (Math.random() * 0xffffffff) >>> 0;
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n)) return n >>> 0;
  }
  return hashString(trimmed);
}

/** Mulberry32: small, fast, fully specified PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of 2D coords + seed -> [0,1). Stateless, so call order never matters. */
export function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash3(x: number, y: number, z: number, seed: number): number {
  return hash2(x + Math.imul(y | 0, 0x3c6ef372), z ^ Math.imul(y | 0, 0x7f4a7c15), seed);
}
