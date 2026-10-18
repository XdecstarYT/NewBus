/**
 * Seeded PRNG (mulberry32). The engine never calls Math.random directly so
 * tests and simulations are reproducible.
 */
export interface Rng {
  next(): number; // [0,1)
  int(min: number, max: number): number; // inclusive
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  weighted<T>(items: readonly T[], weight: (t: T) => number): T;
  seed: number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    seed,
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (items, weight) => {
      const total = items.reduce((s, i) => s + Math.max(0, weight(i)), 0);
      let r = next() * total;
      for (const i of items) {
        r -= Math.max(0, weight(i));
        if (r < 0) return i;
      }
      return items[items.length - 1];
    },
  };
  return rng;
}

/** Non-deterministic seed for live gameplay (tests pass explicit seeds). */
export function randomSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0;
}

/** Shared live RNG for the server process (re-seedable in tests). */
let live = makeRng(randomSeed());
export const liveRng = () => live;
export function reseedLive(seed: number) {
  live = makeRng(seed);
}
