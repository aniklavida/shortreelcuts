/**
 * A tiny seeded PRNG so every stub stage is deterministic given the plan's
 * own `seed` field — the same brief and seed always propose the same
 * candidates in the same order, which matters for a spike: a reviewer who
 * reruns a session should see the same "four clips it did not pick" a
 * second time, not a shuffled set.
 *
 * mulberry32 — public-domain algorithm shape, reimplemented from the
 * well-known one-line description (a 32-bit state, xorshift plus a
 * multiply), not copied from any project in this category or elsewhere.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks one element deterministically. Never empty-safe by design — callers always pass a non-empty list. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  const index = Math.floor(rng() * items.length) % items.length;
  return items[index] as T;
}
