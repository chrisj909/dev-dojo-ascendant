/**
 * Lazy resource regeneration — SPEC §2.1.
 *
 * Energy and Focus are never advanced by a scheduled job. The database stores a
 * value and the timestamp that value was last correct at; the current value is
 * derived on read. This module is the only place that derivation lives.
 *
 * Two rules carry the whole design, and both are easy to get subtly wrong:
 *
 *   1. On every read, the stored timestamp advances by *every whole tick that
 *      elapsed*, even when the value clamps at the cap.
 *
 *      Advancing only by the ticks actually consumed (`cap - value`) looks
 *      correct and passes a naive test, but it leaves the unconsumed remainder
 *      of a long absence sitting in the timestamp. The moment the player
 *      spends, that remainder materialises and the bar refills for free. A
 *      month offline becomes a month of banked Energy. See the "must not bank
 *      invisibly" block in tests/unit/resources.test.ts.
 *
 *   2. The timestamp is *never* set to `now`.
 *
 *      Setting it to `now` on a spend throws away the fraction of a tick the
 *      player had already waited through. Advancing by whole ticks only keeps
 *      that fraction, which is SPEC §7 test 2.
 *
 * Together those pin the stored timestamp into the half-open window
 * `(now - regenMs, now]` — never in the future, never more than one tick stale.
 */

import {
  ENERGY_CAP_BASE,
  ENERGY_REGEN_MS,
  FOCUS_CAP_BASE,
  FOCUS_CAP_STAMINA_DIVISOR,
  FOCUS_REGEN_MS,
} from '@/lib/constants';

/** A resource column pair: the stored value and the instant it was correct at. */
export type ResourceState = {
  value: number;
  updatedAt: Date;
};

/** How a particular resource regenerates for a particular player. */
export type RegenSpec = {
  /** Milliseconds of elapsed time that yield one point. */
  regenMs: number;
  /** Maximum value this player's bar can hold. */
  cap: number;
};

export type SpendResult =
  | { ok: true; state: ResourceState; spent: number }
  | {
      ok: false;
      reason: 'insufficient';
      state: ResourceState;
      available: number;
      short: number;
    };

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

function assertStamina(stamina: number): number {
  if (!Number.isFinite(stamina) || stamina < 0) {
    throw new RangeError(`stamina must be a finite number >= 0, received ${stamina}`);
  }
  return Math.floor(stamina);
}

/** Energy cap for a headmaster with the given Stamina. SPEC §4. */
export function energyCap(stamina: number): number {
  return ENERGY_CAP_BASE + assertStamina(stamina);
}

/** Focus cap for a headmaster with the given Stamina. SPEC §4. */
export function focusCap(stamina: number): number {
  return FOCUS_CAP_BASE + Math.floor(assertStamina(stamina) / FOCUS_CAP_STAMINA_DIVISOR);
}

export function energySpec(stamina: number): RegenSpec {
  return { regenMs: ENERGY_REGEN_MS, cap: energyCap(stamina) };
}

export function focusSpec(stamina: number): RegenSpec {
  return { regenMs: FOCUS_REGEN_MS, cap: focusCap(stamina) };
}

// ---------------------------------------------------------------------------
// Core derivation
// ---------------------------------------------------------------------------

function assertState(state: ResourceState): { value: number; updatedAtMs: number } {
  if (!Number.isFinite(state.value)) {
    throw new TypeError(`resource value must be finite, received ${state.value}`);
  }
  const updatedAtMs = state.updatedAt.getTime();
  if (!Number.isFinite(updatedAtMs)) {
    throw new TypeError('resource updatedAt must be a valid Date');
  }
  // A negative stored value is not a legal state, but clamping is safer than
  // propagating it into a spend check.
  return { value: Math.max(0, Math.floor(state.value)), updatedAtMs };
}

function assertSpec(spec: RegenSpec): { regenMs: number; cap: number } {
  if (!Number.isFinite(spec.regenMs) || spec.regenMs <= 0) {
    throw new RangeError(`regenMs must be a positive number, received ${spec.regenMs}`);
  }
  if (!Number.isFinite(spec.cap) || spec.cap < 0) {
    throw new RangeError(`cap must be a finite number >= 0, received ${spec.cap}`);
  }
  return { regenMs: Math.floor(spec.regenMs), cap: Math.floor(spec.cap) };
}

/**
 * Bring a stored resource up to date as of `now`.
 *
 * Pure, total, and idempotent for a fixed `now`: calling it repeatedly with the
 * same instant returns the same state. `now` is an explicit parameter rather
 * than a call to `Date.now()` precisely so that this is testable without fake
 * timers and reproducible on the server.
 */
export function regenerate(state: ResourceState, now: Date, spec: RegenSpec): ResourceState {
  const { value, updatedAtMs } = assertState(state);
  const { regenMs, cap } = assertSpec(spec);

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new TypeError('now must be a valid Date');
  }

  const elapsedMs = nowMs - updatedAtMs;

  // Clock skew, or simply no time passed. Never regress the value and never
  // move the timestamp — a backwards clock must not cost the player anything.
  if (elapsedMs <= 0) {
    return { value: Math.min(value, cap), updatedAt: new Date(updatedAtMs) };
  }

  // Integer millisecond arithmetic throughout. No floating point enters the
  // tick count, so a 10-hour gap is exactly 100 ticks and never 99.999...
  const ticks = Math.floor(elapsedMs / regenMs);

  return {
    // Rule 1: advance by every elapsed tick, not just the ones we could use.
    updatedAt: new Date(updatedAtMs + ticks * regenMs),
    value: Math.min(value + ticks, cap),
  };
}

/**
 * Deduct `amount` after bringing the resource up to date.
 *
 * On success the returned state carries the regenerated timestamp untouched —
 * spending does not reset the regen clock (rule 2). On failure the resource is
 * still returned regenerated, so a caller that persists it loses nothing, but
 * nothing is deducted.
 */
export function spend(
  state: ResourceState,
  amount: number,
  now: Date,
  spec: RegenSpec,
): SpendResult {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`spend amount must be a non-negative integer, received ${amount}`);
  }

  const current = regenerate(state, now, spec);

  if (current.value < amount) {
    return {
      ok: false,
      reason: 'insufficient',
      state: current,
      available: current.value,
      short: amount - current.value,
    };
  }

  return {
    ok: true,
    spent: amount,
    // Rule 2: `updatedAt` is carried through unchanged. The partial tick the
    // player had already accumulated survives the spend.
    state: { value: current.value - amount, updatedAt: current.updatedAt },
  };
}

/** Add points without exceeding the cap — used by refunds and rewards. */
export function grant(
  state: ResourceState,
  amount: number,
  now: Date,
  spec: RegenSpec,
): ResourceState {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`grant amount must be a non-negative integer, received ${amount}`);
  }
  const current = regenerate(state, now, spec);
  const { cap } = assertSpec(spec);
  return { value: Math.min(current.value + amount, cap), updatedAt: current.updatedAt };
}

// ---------------------------------------------------------------------------
// UI countdowns
// ---------------------------------------------------------------------------

/**
 * Milliseconds until the next whole point arrives, or `null` when the bar is
 * already full and no more points are coming.
 */
export function msUntilNext(state: ResourceState, now: Date, spec: RegenSpec): number | null {
  const { regenMs, cap } = assertSpec(spec);
  const current = regenerate(state, now, spec);
  if (current.value >= cap) return null;

  // After regenerate, `now - updatedAt` is the progress into the current tick,
  // within [0, regenMs) — UNLESS the caller's clock is behind the stored
  // timestamp, which happens routinely: this runs in a browser, against a
  // timestamp the server wrote.
  //
  // `regenerate` does nothing at all while now < updatedAt, so the wait is that
  // deficit PLUS a full tick. Clamping it away instead made this disagree with
  // `regenerate` and froze the countdown for the duration of the skew.
  const deficit = Math.max(0, current.updatedAt.getTime() - now.getTime());
  const intoTick = Math.max(0, now.getTime() - current.updatedAt.getTime());
  return deficit + regenMs - intoTick;
}

/**
 * Milliseconds until the bar reaches its cap, or `null` when it already has.
 */
export function msUntilFull(state: ResourceState, now: Date, spec: RegenSpec): number | null {
  const { regenMs, cap } = assertSpec(spec);
  const current = regenerate(state, now, spec);
  if (current.value >= cap) return null;

  // Same clock-skew correction as msUntilNext: nothing accrues until the
  // caller's clock reaches the stored timestamp.
  const missing = cap - current.value;
  const deficit = Math.max(0, current.updatedAt.getTime() - now.getTime());
  const intoTick = Math.max(0, now.getTime() - current.updatedAt.getTime());
  return deficit + missing * regenMs - intoTick;
}

/** Convenience for rendering: the fraction of the bar that is filled, 0..1. */
export function fillRatio(state: ResourceState, now: Date, spec: RegenSpec): number {
  const { cap } = assertSpec(spec);
  if (cap === 0) return 1;
  return regenerate(state, now, spec).value / cap;
}
