/**
 * Seeded, reproducible randomness. SPEC §2.3.
 *
 *   "Seed every resolution with a stored seed. Battle reports are regenerated
 *    from `(seed, snapshot)` rather than stored as prose."
 *
 * Everything the server rolls — combat jitter, scroll drops, recruit quality,
 * branch style drift — comes from here, and `Math.random()` appears nowhere in
 * this codebase. A battle report regenerated a year later must read exactly as
 * it did the day it resolved.
 *
 * ALGORITHM: xoshiro128**, seeded through splitmix32.
 *
 * Chosen because it is fast in plain JavaScript (four 32-bit words, all
 * operations expressible with `Math.imul` and shifts, no BigInt in the hot
 * path), has a period of 2^128 - 1, and passes the standard statistical
 * batteries. A 32-bit generator like mulberry32 would be simpler but its 2^32
 * period is uncomfortably close to the number of draws a long simulation makes.
 *
 * It is NOT cryptographic. Nothing here should ever protect anything; it
 * decides where a scroll dropped.
 *
 * The seeding step matters as much as the generator. Challenge seeds are stored
 * as `bigint` and may be sequential, so feeding a raw counter straight into the
 * state would give neighbouring matches visibly related streams. splitmix32
 * avalanches each word first.
 */

export type Rng = {
  /** The raw 32-bit output. Uniform over [0, 2^32). */
  next(): number;
  /** Uniform in [0, 1). */
  float(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** A uniformly chosen element. */
  pick<T>(values: readonly T[]): T;
  /** An element chosen in proportion to its weight. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
  /** A shuffled copy. The input is not mutated. */
  shuffle<T>(values: readonly T[]): T[];
};

/** Mix a 32-bit word so that nearby seeds produce unrelated states. */
function splitmix32(state: number): { value: number; state: number } {
  let z = (state + 0x9e3779b9) | 0;
  const nextState = z;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return { value: (z ^ (z >>> 15)) >>> 0, state: nextState };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Build a generator from a seed.
 *
 * Accepts `bigint` because that is how seeds are stored (SPEC §3
 * `challenges.seed bigint`), and `number` for convenience in tests and
 * simulations. Both routes agree for values a `number` can hold exactly.
 */
export function seeded(seed: bigint | number): Rng {
  const asBigInt = typeof seed === 'bigint' ? seed : BigInt(Math.trunc(seed));
  // Fold the full 64-bit space into two words so high bits are not discarded —
  // otherwise seeds differing only above 2^32 collide.
  const low = Number(BigInt.asUintN(32, asBigInt));
  const high = Number(BigInt.asUintN(32, asBigInt >> 32n));

  let mixer = (low ^ Math.imul(high, 0x9e3779b9)) | 0;
  const state = new Uint32Array(4);
  for (let i = 0; i < 4; i += 1) {
    const stepped = splitmix32(mixer);
    mixer = stepped.state;
    state[i] = stepped.value;
  }
  // An all-zero state is a fixed point of xoshiro and would emit only zeroes.
  if ((state[0] | state[1] | state[2] | state[3]) === 0) state[0] = 0x9e3779b9;

  const next = (): number => {
    const result = Math.imul(rotl(Math.imul(state[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (state[1] << 9) >>> 0;

    state[2] = (state[2] ^ state[0]) >>> 0;
    state[3] = (state[3] ^ state[1]) >>> 0;
    state[1] = (state[1] ^ state[2]) >>> 0;
    state[0] = (state[0] ^ state[3]) >>> 0;
    state[2] = (state[2] ^ t) >>> 0;
    state[3] = rotl(state[3], 11);

    return result;
  };

  const float = (): number => next() / 4294967296;

  const rng: Rng = {
    next,
    float,

    range(min, max) {
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new RangeError(`range bounds must be finite, received ${min}..${max}`);
      }
      return min + float() * (max - min);
    },

    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new RangeError(`int bounds must be integers, received ${min}..${max}`);
      }
      if (max < min) {
        throw new RangeError(`int bounds are inverted: ${min}..${max}`);
      }
      const span = max - min + 1;

      // Rejection sampling. `next() % span` is the obvious version and it
      // biases toward the low end whenever span does not divide 2^32 — which
      // would quietly skew every drop table and recruit roll in the game.
      const limit = Math.floor(4294967296 / span) * span;
      let draw = next();
      while (draw >= limit) draw = next();
      return min + (draw % span);
    },

    pick(values) {
      if (values.length === 0) throw new RangeError('cannot pick from an empty array');
      return values[rng.int(0, values.length - 1)];
    },

    weighted(entries) {
      let total = 0;
      for (const [, weight] of entries) {
        if (!Number.isFinite(weight) || weight < 0) {
          throw new RangeError(`weights must be finite and non-negative, received ${weight}`);
        }
        total += weight;
      }
      if (total <= 0) throw new RangeError('weights must sum to more than zero');

      let roll = float() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        // Strictly less-than, so a zero-weight entry can never win: its
        // subtraction leaves `roll` exactly where it was.
        if (roll < 0) return value;
      }
      // Only reachable through floating-point drift at the very top of the
      // range. Return the last entry with a non-zero weight.
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        if (entries[i][1] > 0) return entries[i][0];
      }
      throw new RangeError('weights must sum to more than zero');
    },

    shuffle(values) {
      const result = [...values];
      // Fisher-Yates, downward. The bound is `i` inclusive, which is what makes
      // every element reachable in every position; the common off-by-one pins
      // an element and would silently invalidate squad ordering (SPEC §7 test 5).
      for (let i = result.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i);
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    },
  };

  return rng;
}

/**
 * A normally distributed sample. Used for branch style drift (SPEC §5.3).
 *
 * Box-Muller. Takes the generator rather than owning one so a caller's whole
 * resolution stays on a single reproducible stream.
 */
export function gaussian(rng: Rng, mean = 0, sigma = 1): number {
  // `float()` can return exactly 0, and log(0) is -Infinity. Draw again rather
  // than nudging the value, which would put a spike at the extreme.
  let u = rng.float();
  while (u === 0) u = rng.float();
  const v = rng.float();
  return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
