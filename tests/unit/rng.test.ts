/**
 * The seeded random number generator. SPEC §2.3.
 *
 *   "Seed every resolution with a stored seed. Battle reports are regenerated
 *    from `(seed, snapshot)` rather than stored as prose."
 *
 * That claim only holds if the generator is genuinely reproducible — same seed,
 * same sequence, forever, on any machine. `Math.random()` cannot do it, and
 * neither can anything seeded from the clock. SPEC §7 test 11 ("all resolution
 * is reproducible from (seed, snapshot)") ultimately rests on this file.
 *
 * The sequences below are pinned to literal values on purpose. If an
 * implementation change alters them, every stored battle report in the database
 * silently starts regenerating differently — a save-breaking change that would
 * otherwise pass every behavioural test.
 */

import { describe, expect, it } from 'vitest';

import { gaussian, seeded, type Rng } from '@/lib/game/rng';

const draws = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.next());

describe('reproducibility — the property the design depends on', () => {
  it('produces an identical sequence from an identical seed', () => {
    expect(draws(seeded(12345n), 10)).toEqual(draws(seeded(12345n), 10));
  });

  it('produces a different sequence from a different seed', () => {
    expect(draws(seeded(1n), 10)).not.toEqual(draws(seeded(2n), 10));
  });

  it('is unaffected by seeds that differ only in high bits', () => {
    // A weak seeding step collapses nearby or sparse seeds onto the same
    // stream. Challenge seeds are stored as bigint and may well be sequential.
    const a = draws(seeded(1n), 5);
    const b = draws(seeded(2n ** 40n + 1n), 5);
    expect(a).not.toEqual(b);
  });

  it('gives sequential seeds unrelated streams', () => {
    const streams = [1n, 2n, 3n, 4n, 5n].map((s) => draws(seeded(s), 4));
    const unique = new Set(streams.map((s) => JSON.stringify(s)));
    expect(unique.size).toBe(5);
  });

  it('accepts a number as well as a bigint, and agrees with itself', () => {
    expect(draws(seeded(42), 5)).toEqual(draws(seeded(42n), 5));
  });

  it('resumes identically after being rebuilt from the same seed mid-stream', () => {
    const original = seeded(777n);
    draws(original, 3);
    const continued = draws(original, 3);

    const rebuilt = seeded(777n);
    draws(rebuilt, 3);
    expect(draws(rebuilt, 3)).toEqual(continued);
  });

  /**
   * The golden values, RECORDED from the implementation rather than derived.
   *
   * This test does not check that the generator is good — the distribution
   * tests above do that. It checks that it never CHANGES. Swapping the
   * algorithm, or altering the seeding step, silently re-rolls every battle
   * report ever stored, because SPEC §2.3 regenerates them from (seed,
   * snapshot) instead of persisting the prose. A failure here means a
   * save-breaking change, and should be treated as one.
   */
  it('matches its pinned output', () => {
    expect(draws(seeded(1n), 4)).toEqual([393288148, 2174103013, 3814759091, 2092745082]);
  });
});

describe('float', () => {
  it('stays within [0, 1)', () => {
    const rng = seeded(9n);
    for (let i = 0; i < 20_000; i += 1) {
      const value = rng.float();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is roughly uniform across deciles', () => {
    const rng = seeded(4242n);
    const buckets = new Array(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i += 1) buckets[Math.floor(rng.float() * 10)] += 1;
    for (const count of buckets) {
      // Each decile should hold ~10%. A generator with a stuck bit or a bad
      // low-order word fails this loudly.
      expect(count / n).toBeGreaterThan(0.09);
      expect(count / n).toBeLessThan(0.11);
    }
  });
});

describe('range', () => {
  it('honours both bounds', () => {
    // SPEC §5.1 uses rng.range(-0.12, 0.12) for combat jitter.
    const rng = seeded(5n);
    for (let i = 0; i < 20_000; i += 1) {
      const value = rng.range(-0.12, 0.12);
      expect(value).toBeGreaterThanOrEqual(-0.12);
      expect(value).toBeLessThan(0.12);
    }
  });

  it('centres where it should', () => {
    const rng = seeded(6n);
    let sum = 0;
    const n = 50_000;
    for (let i = 0; i < n; i += 1) sum += rng.range(-0.12, 0.12);
    expect(Math.abs(sum / n)).toBeLessThan(0.002);
  });
});

describe('int', () => {
  it('includes both endpoints', () => {
    const rng = seeded(11n);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i += 1) seen.add(rng.int(1, 5));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('is uniform enough not to bias a drop table', () => {
    // Modulo bias is the classic failure here and it silently skews every
    // scroll drop and recruit roll.
    const rng = seeded(13n);
    const counts = new Map<number, number>();
    const n = 120_000;
    for (let i = 0; i < n; i += 1) {
      const v = rng.int(0, 5);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    for (const [, count] of counts) {
      expect(count / n).toBeGreaterThan(0.16);
      expect(count / n).toBeLessThan(0.174);
    }
  });

  it('handles a single-value range', () => {
    const rng = seeded(14n);
    expect(rng.int(7, 7)).toBe(7);
  });

  it('rejects an inverted range rather than returning nonsense', () => {
    expect(() => seeded(1n).int(5, 1)).toThrow();
  });
});

describe('pick and shuffle', () => {
  it('picks only from the array, and reaches every element', () => {
    const rng = seeded(21n);
    const options = ['a', 'b', 'c', 'd'];
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(rng.pick(options));
    expect([...seen].sort()).toEqual(options);
  });

  it('refuses to pick from nothing', () => {
    expect(() => seeded(1n).pick([])).toThrow();
  });

  it('shuffles into a permutation, deterministically, without mutating the input', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = seeded(31n).shuffle(source);
    const b = seeded(31n).shuffle(source);

    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).not.toEqual(source); // vanishingly unlikely to be identity
  });

  it('reaches every position, so the shuffle is not partial', () => {
    // A Fisher-Yates with an off-by-one leaves the first or last element
    // pinned, which is easy to miss and ruins squad ordering (SPEC §7 test 5).
    const positionsSeen = new Map<number, Set<number>>();
    for (let seed = 0; seed < 400; seed += 1) {
      const result = seeded(BigInt(seed)).shuffle([0, 1, 2, 3, 4]);
      result.forEach((value, index) => {
        if (!positionsSeen.has(value)) positionsSeen.set(value, new Set());
        positionsSeen.get(value)!.add(index);
      });
    }
    for (const [, positions] of positionsSeen) expect(positions.size).toBe(5);
  });
});

describe('weighted', () => {
  it('respects the weights', () => {
    const rng = seeded(41n);
    const counts: Record<'common' | 'rare', number> = { common: 0, rare: 0 };
    const n = 60_000;
    for (let i = 0; i < n; i += 1) {
      const drawn = rng.weighted<'common' | 'rare'>([
        ['common', 9],
        ['rare', 1],
      ]);
      counts[drawn] += 1;
    }
    expect(counts.rare / n).toBeGreaterThan(0.09);
    expect(counts.rare / n).toBeLessThan(0.11);
  });

  it('never returns a zero-weight entry', () => {
    const rng = seeded(43n);
    for (let i = 0; i < 5000; i += 1) {
      expect(
        rng.weighted([
          ['yes', 1],
          ['never', 0],
        ]),
      ).toBe('yes');
    }
  });

  it('rejects weights that sum to zero', () => {
    expect(() => seeded(1n).weighted([['a', 0]])).toThrow();
  });
});

describe('gaussian', () => {
  it('lands on the requested mean and sigma', () => {
    // SPEC §5.3 uses gaussian(0, STYLE_DRIFT_SIGMA) for branch style drift.
    const rng = seeded(51n);
    const n = 200_000;
    const values = Array.from({ length: n }, () => gaussian(rng, 0, 0.08));
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;

    expect(Math.abs(mean)).toBeLessThan(0.002);
    expect(Math.sqrt(variance)).toBeGreaterThan(0.078);
    expect(Math.sqrt(variance)).toBeLessThan(0.082);
  });

  it('is reproducible', () => {
    const a = seeded(52n);
    const b = seeded(52n);
    expect(Array.from({ length: 5 }, () => gaussian(a, 1, 2))).toEqual(
      Array.from({ length: 5 }, () => gaussian(b, 1, 2)),
    );
  });

  it('is finite even at the tails', () => {
    // Box-Muller returns Infinity if it ever draws exactly 0 for the log.
    const rng = seeded(53n);
    for (let i = 0; i < 100_000; i += 1) {
      expect(Number.isFinite(gaussian(rng, 0, 1))).toBe(true);
    }
  });
});
