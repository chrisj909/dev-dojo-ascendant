/**
 * SPEC §7 test 1 and test 2 — the load-bearing claims of lazy regeneration.
 *
 *   1. Energy regen across a simulated 10-hour offline gap lands exactly on cap,
 *      not over, and not lost to rounding.
 *   2. Spending Energy at a partial tick does not discard the partial tick.
 *
 * These were written before `lib/game/resources.ts` existed. Everything else in
 * this file exists because writing tests 1 and 2 exposed adjacent ways the
 * implementation could be plausible and wrong — most importantly the "banking"
 * failure in the `at cap` describe block, which a naive implementation passes
 * tests 1 and 2 with and still ships an exploit.
 */

import { describe, expect, it } from 'vitest';

import {
  ENERGY_CAP_BASE,
  ENERGY_REGEN_MS,
  FOCUS_CAP_BASE,
  FOCUS_CAP_STAMINA_DIVISOR,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
} from '@/lib/constants';
import {
  energyCap,
  energySpec,
  focusCap,
  focusSpec,
  msUntilFull,
  msUntilNext,
  regenerate,
  spend,
  type ResourceState,
} from '@/lib/game/resources';

/** A fixed, arbitrary wall-clock origin. Nothing here depends on the real clock. */
const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);
const state = (value: number, updatedAt: Date = T0): ResourceState => ({
  value,
  updatedAt,
});

describe('caps', () => {
  it('energy cap is base + stamina', () => {
    expect(energyCap(0)).toBe(ENERGY_CAP_BASE);
    expect(energyCap(5)).toBe(ENERGY_CAP_BASE + 5);
    expect(energyCap(50)).toBe(100);
  });

  it('focus cap is base + floor(stamina / divisor)', () => {
    expect(focusCap(0)).toBe(FOCUS_CAP_BASE);
    expect(focusCap(5)).toBe(FOCUS_CAP_BASE);
    expect(focusCap(FOCUS_CAP_STAMINA_DIVISOR)).toBe(FOCUS_CAP_BASE + 1);
    expect(focusCap(25)).toBe(FOCUS_CAP_BASE + 2);
  });

  it('rejects a negative stamina rather than shrinking the cap', () => {
    expect(() => energyCap(-1)).toThrow();
    expect(() => focusCap(-1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SPEC §7 TEST 1
// ---------------------------------------------------------------------------

describe('SPEC test 1 — a 10-hour offline gap lands exactly on cap', () => {
  const TEN_HOURS = 10 * MS_PER_HOUR;

  it('lands exactly on cap and not one point over', () => {
    // 10h / 6min = 100 ticks. Cap with the default stamina of 5 is 55, so the
    // gap is more than enough to fill and the result must clamp precisely.
    const spec = energySpec(5);
    expect(spec.cap).toBe(55);

    const result = regenerate(state(0), at(TEN_HOURS), spec);

    expect(result.value).toBe(55);
    expect(result.value).toBe(spec.cap);
    expect(result.value).not.toBe(spec.cap + 1);
  });

  it('gains exactly 100 points when the cap is not the binding constraint', () => {
    // stamina 100 -> cap 150, so 10h of regen is measured, not clamped.
    // This is the "not lost to rounding" half of the claim: exactly 100, never
    // 99 from a floating-point division and never 101 from a ceil.
    const spec = energySpec(100);
    expect(spec.cap).toBe(150);

    const result = regenerate(state(0), at(TEN_HOURS), spec);

    expect(result.value).toBe(100);
  });

  it('lands on cap exactly, from a non-zero starting value', () => {
    // cap 55, start 12 -> needs 43 ticks. 10h supplies 100. Still exactly 55.
    const spec = energySpec(5);
    const result = regenerate(state(12), at(TEN_HOURS), spec);
    expect(result.value).toBe(55);
  });

  it('a gap that is an exact multiple of the tick leaves no remainder behind', () => {
    // 10h is exactly 100 ticks, so the stored timestamp must advance the full
    // 10h and land precisely on `now` — nothing is dropped and nothing is owed.
    const spec = energySpec(100);
    const result = regenerate(state(0), at(TEN_HOURS), spec);
    expect(result.updatedAt.getTime()).toBe(T0.getTime() + TEN_HOURS);
    expect(result.updatedAt.getTime()).toBe(at(TEN_HOURS).getTime());
  });

  it('does not round a sub-tick remainder up into a free point', () => {
    // 10h minus 1ms is 99 whole ticks plus 359999ms, so 99 points, not 100.
    const spec = energySpec(100);
    const result = regenerate(state(0), at(TEN_HOURS - 1), spec);
    expect(result.value).toBe(99);
    expect(result.updatedAt.getTime()).toBe(T0.getTime() + 99 * ENERGY_REGEN_MS);
  });

  it('holds for Focus across the same gap', () => {
    // Focus regenerates hourly and caps at 5 with default stamina, so a 10h gap
    // fills it and clamps rather than banking 10.
    const spec = focusSpec(5);
    expect(spec.cap).toBe(5);
    const result = regenerate(state(0), at(TEN_HOURS), spec);
    expect(result.value).toBe(5);
  });

  it('is stable under repeated reads — reading does not manufacture points', () => {
    const spec = energySpec(5);
    const once = regenerate(state(0), at(TEN_HOURS), spec);
    const twice = regenerate(once, at(TEN_HOURS), spec);
    const thrice = regenerate(twice, at(TEN_HOURS), spec);
    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
  });

  it('gains the same total whether read once or in many small steps', () => {
    // Reading the row every minute for 10 hours must not lose the sub-tick
    // remainders and end up behind a single read across the whole gap.
    const spec = energySpec(100);
    let incremental = state(0);
    for (let minute = 1; minute <= 600; minute += 1) {
      incremental = regenerate(incremental, at(minute * MS_PER_MINUTE), spec);
    }
    const single = regenerate(state(0), at(TEN_HOURS), spec);

    expect(incremental.value).toBe(single.value);
    expect(incremental.updatedAt.getTime()).toBe(single.updatedAt.getTime());
  });
});

// ---------------------------------------------------------------------------
// SPEC §7 TEST 2
// ---------------------------------------------------------------------------

describe('SPEC test 2 — spending at a partial tick does not discard the partial tick', () => {
  it('keeps the timestamp put when no whole tick has elapsed', () => {
    // 5 minutes into a 6 minute tick. Spending must not reset the clock to now;
    // that would silently cost the player the 5 minutes they had already waited.
    const spec = energySpec(5);
    const now = at(5 * MS_PER_MINUTE);

    const result = spend(state(10), 3, now, spec);

    expect(result.ok).toBe(true);
    expect(result.state.value).toBe(7);
    expect(result.state.updatedAt.getTime()).toBe(T0.getTime());
    expect(result.state.updatedAt.getTime()).not.toBe(now.getTime());
  });

  it('delivers the next point 1 minute after that spend, not 6', () => {
    // The observable consequence of the assertion above.
    const spec = energySpec(5);
    const afterSpend = spend(state(10), 3, at(5 * MS_PER_MINUTE), spec).state;

    // One more minute completes the tick that was already 5/6 done.
    expect(regenerate(afterSpend, at(6 * MS_PER_MINUTE), spec).value).toBe(8);
    // A naive implementation that reset the timestamp would still read 7 here.
    expect(regenerate(afterSpend, at(10 * MS_PER_MINUTE), spec).value).toBe(8);
    expect(regenerate(afterSpend, at(12 * MS_PER_MINUTE), spec).value).toBe(9);
  });

  it('preserves the remainder when whole ticks and a partial tick both elapsed', () => {
    // 14 minutes = 2 whole ticks (12 min) + 2 min of remainder.
    const spec = energySpec(5);
    const now = at(14 * MS_PER_MINUTE);

    const result = spend(state(10), 5, now, spec);

    expect(result.ok).toBe(true);
    expect(result.state.value).toBe(7); // 10 + 2 gained - 5 spent
    // The timestamp advances by the two whole ticks only, banking the 2 min.
    expect(result.state.updatedAt.getTime()).toBe(T0.getTime() + 12 * MS_PER_MINUTE);
    // 4 minutes later the third tick completes.
    expect(regenerate(result.state, at(18 * MS_PER_MINUTE), spec).value).toBe(8);
  });

  it('never leaves the stored timestamp in the future', () => {
    const spec = energySpec(5);
    for (const minutes of [0, 1, 5, 6, 7, 11, 12, 13, 59, 60, 61]) {
      const now = at(minutes * MS_PER_MINUTE);
      const result = regenerate(state(3), now, spec);
      expect(result.updatedAt.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('never leaves the stored timestamp more than one tick behind now', () => {
    // The complement of the test above. Together they pin the timestamp into
    // the half-open window (now - tick, now].
    const spec = energySpec(5);
    for (const minutes of [6, 7, 30, 120, 600, 60 * 24 * 30]) {
      const now = at(minutes * MS_PER_MINUTE);
      const result = regenerate(state(0), now, spec);
      const lag = now.getTime() - result.updatedAt.getTime();
      expect(lag).toBeGreaterThanOrEqual(0);
      expect(lag).toBeLessThan(ENERGY_REGEN_MS);
    }
  });

  it('spending zero is a no-op that still banks elapsed regen', () => {
    const spec = energySpec(5);
    const result = spend(state(10), 0, at(7 * MS_PER_MINUTE), spec);
    expect(result.ok).toBe(true);
    expect(result.state.value).toBe(11);
    expect(result.state.updatedAt.getTime()).toBe(T0.getTime() + 6 * MS_PER_MINUTE);
  });

  it('holds for Focus, whose partial ticks are worth an hour each', () => {
    const spec = focusSpec(5);
    const now = at(59 * MS_PER_MINUTE);
    const result = spend(state(3), 2, now, spec);

    expect(result.ok).toBe(true);
    expect(result.state.value).toBe(1);
    expect(result.state.updatedAt.getTime()).toBe(T0.getTime());
    // One minute later, the hour completes.
    expect(regenerate(result.state, at(60 * MS_PER_MINUTE), spec).value).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The failure mode that tests 1 and 2 alone do not catch.
// ---------------------------------------------------------------------------

describe('at cap — elapsed time must not bank invisibly', () => {
  it('does not hand back a full bar seconds after it was drained', () => {
    // The exploit: an implementation that advances the timestamp only by the
    // ticks it actually consumed (cap - value) leaves the rest of a long
    // absence unspent. Drain the bar and it materialises instantly.
    const spec = energySpec(5); // cap 55
    const thirtyDaysLater = at(30 * MS_PER_DAY);

    const full = regenerate(state(0), thirtyDaysLater, spec);
    expect(full.value).toBe(55);

    const drained = spend(full, 55, thirtyDaysLater, spec);
    expect(drained.ok).toBe(true);
    expect(drained.state.value).toBe(0);

    // Six minutes later the player has 1 point. Not 55.
    const sixMinutesOn = new Date(thirtyDaysLater.getTime() + ENERGY_REGEN_MS);
    expect(regenerate(drained.state, sixMinutesOn, spec).value).toBe(1);

    // An hour later, 10. Still not 55.
    const anHourOn = new Date(thirtyDaysLater.getTime() + MS_PER_HOUR);
    expect(regenerate(drained.state, anHourOn, spec).value).toBe(10);
  });

  it('advances the timestamp while sitting at cap', () => {
    const spec = energySpec(5);
    const later = at(30 * MS_PER_DAY);
    const result = regenerate(state(55), later, spec);

    expect(result.value).toBe(55);
    expect(later.getTime() - result.updatedAt.getTime()).toBeLessThan(ENERGY_REGEN_MS);
  });

  it('does not credit progress toward a cap that did not exist yet', () => {
    // Player sat at cap 55 for a week, then Stamina rose and the cap became 60.
    // They start earning toward 60 from now, not from a week of stored credit.
    const aWeek = at(7 * MS_PER_DAY);
    const atCap = regenerate(state(0), aWeek, energySpec(5));
    expect(atCap.value).toBe(55);

    const raised = energySpec(10); // cap 60
    const justAfter = new Date(aWeek.getTime() + ENERGY_REGEN_MS);
    const result = regenerate(atCap, justAfter, raised);

    expect(result.value).toBe(56);
    expect(result.value).not.toBe(60);
  });

  it('clamps down when the cap drops below the stored value', () => {
    const dropped = regenerate(state(80), at(MS_PER_MINUTE), energySpec(5));
    expect(dropped.value).toBe(55);
  });
});

describe('hostile inputs', () => {
  it('does not regress the value when the clock runs backwards', () => {
    const spec = energySpec(5);
    const result = regenerate(state(20, at(MS_PER_HOUR)), T0, spec);
    expect(result.value).toBe(20);
    expect(result.updatedAt.getTime()).toBe(T0.getTime() + MS_PER_HOUR);
  });

  it('refuses to spend more than is available and leaves the row untouched', () => {
    const spec = energySpec(5);
    const result = spend(state(4), 5, at(MS_PER_MINUTE), spec);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('insufficient');
    expect(result.available).toBe(4);
    expect(result.short).toBe(1);
    expect(result.state.value).toBe(4);
  });

  it('counts regen before deciding a spend is unaffordable', () => {
    // 4 stored + 2 earned = 6, so a spend of 5 succeeds.
    const spec = energySpec(5);
    const result = spend(state(4), 5, at(13 * MS_PER_MINUTE), spec);
    expect(result.ok).toBe(true);
    expect(result.state.value).toBe(1);
  });

  it('rejects a negative or fractional spend', () => {
    const spec = energySpec(5);
    expect(() => spend(state(10), -1, at(0), spec)).toThrow();
    expect(() => spend(state(10), 1.5, at(0), spec)).toThrow();
    expect(() => spend(state(10), Number.NaN, at(0), spec)).toThrow();
  });

  it('rejects a non-finite or invalid stored state', () => {
    const spec = energySpec(5);
    expect(() => regenerate(state(Number.NaN), at(0), spec)).toThrow();
    expect(() => regenerate(state(10, new Date(Number.NaN)), at(0), spec)).toThrow();
    expect(() => regenerate(state(10), new Date(Number.NaN), spec)).toThrow();
  });

  it('treats a negative stored value as zero rather than propagating it', () => {
    const spec = energySpec(5);
    expect(regenerate(state(-5), at(6 * MS_PER_MINUTE), spec).value).toBe(1);
  });
});

describe('countdown helpers used by the UI', () => {
  it('reports the milliseconds remaining until the next point', () => {
    const spec = energySpec(5);
    expect(msUntilNext(state(0), T0, spec)).toBe(ENERGY_REGEN_MS);
    expect(msUntilNext(state(0), at(MS_PER_MINUTE), spec)).toBe(5 * MS_PER_MINUTE);
    expect(msUntilNext(state(0), at(7 * MS_PER_MINUTE), spec)).toBe(5 * MS_PER_MINUTE);
  });

  it('reports null for the next point once the bar is full', () => {
    const spec = energySpec(5);
    expect(msUntilNext(state(55), T0, spec)).toBeNull();
    expect(msUntilFull(state(55), T0, spec)).toBeNull();
  });

  it('reports the milliseconds remaining until the bar is full', () => {
    const spec = energySpec(5); // cap 55
    expect(msUntilFull(state(54), T0, spec)).toBe(ENERGY_REGEN_MS);
    expect(msUntilFull(state(0), T0, spec)).toBe(55 * ENERGY_REGEN_MS);
    // 1 minute in, the first of the 55 ticks is already 1 minute along.
    expect(msUntilFull(state(0), at(MS_PER_MINUTE), spec)).toBe(
      55 * ENERGY_REGEN_MS - MS_PER_MINUTE,
    );
  });

  it('agrees with regenerate — waiting msUntilFull yields exactly the cap', () => {
    const spec = energySpec(5);
    const start = state(7, T0);
    const wait = msUntilFull(start, T0, spec);
    expect(wait).not.toBeNull();

    const justBefore = regenerate(start, at(wait! - 1), spec);
    const exactly = regenerate(start, at(wait!), spec);

    expect(justBefore.value).toBe(spec.cap - 1);
    expect(exactly.value).toBe(spec.cap);
  });
});

describe('invariants across a long deterministic walk', () => {
  it('never exceeds the cap, never goes negative, never moves the clock forward', () => {
    const spec = energySpec(5);
    let current = state(0);
    let clock = 0;
    // A fixed pseudo-random walk. Deterministic: no Math.random, no wall clock.
    let seed = 987654321;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let step = 0; step < 5000; step += 1) {
      clock += Math.floor(next() * 3 * ENERGY_REGEN_MS);
      const now = at(clock);
      const want = Math.floor(next() * 8);

      const before = current;
      const result = spend(before, want, now, spec);
      current = result.state;

      expect(current.value).toBeGreaterThanOrEqual(0);
      expect(current.value).toBeLessThanOrEqual(spec.cap);
      expect(Number.isInteger(current.value)).toBe(true);
      expect(current.updatedAt.getTime()).toBeLessThanOrEqual(now.getTime());
      if (!result.ok) {
        // A refused spend must not consume anything beyond banking regen.
        expect(current.value).toBe(regenerate(before, now, spec).value);
      }
    }
  });
});
