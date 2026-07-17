// Deterministic PRNG for demo/seed data. mulberry32 is a small, fast,
// well-distributed 32-bit generator — good enough for synthetic fixtures
// and fully reproducible given the same seed. Nothing here should ever
// call Math.random().

export type Rng = () => number;

/** mulberry32: seed -> generator of floats in [0, 1). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Combine an arbitrary list of strings/numbers into a single 32-bit seed
 * (FNV-1a over the joined string form). Used to derive a per-run RNG seed
 * from stable inputs (market id + run timestamp + ...) so generation is
 * deterministic without any shared mutable state. */
export function seedFrom(...parts: Array<string | number>): number {
  const input = parts.join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Pick a uniformly random element of a non-empty array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pick() called with an empty array');
  }
  return items[Math.floor(rng() * items.length)];
}

/** Pick `count` distinct elements from a non-empty array (no repeats). */
export function pickMany<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const result: T[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
}

/** Random integer in [min, max], inclusive on both ends. */
export function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Random float in [min, max). */
export function float(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Gaussian (normal) sample via Box-Muller, using two draws from rng. */
export function gaussian(rng: Rng, mean: number, sd: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * sd;
}

/** True with probability `p` (0..1). */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}
