/**
 * Dojo creation against a real database.
 *
 * `tests/unit/write-errors.test.ts` proves the classifier maps SQLSTATE and
 * constraint name to the right outcome. It cannot prove that Postgres actually
 * raises the errors it is being fed — those fixtures were hand-written, and a
 * classifier tested only against invented errors is a classifier tested against
 * its author's assumptions.
 *
 * So this file provokes each failure for real and asserts the outcome the user
 * would get. The `stale_session` case is the one that shipped broken: a session
 * naming a deleted `users` row was reported as "you already have a dojo", which
 * redirected to /dojo, which found nothing and redirected back to /create.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { dojos, players, regions, users } from '@/lib/db/schema';
import { createPlayerAndDojo, findDojoState } from '@/lib/repo/dojo';
import { REGION_SEEDS } from '@/lib/db/seed/regions';

import { createHarness, USER_A, USER_B, USER_C, type Harness } from './harness';

let harness: Harness;
let ctx: { db: Harness['db'] };

const T0 = new Date('2026-04-01T09:00:00.000Z');
const OPEN_REGION = REGION_SEEDS.find((r) => r.unlockTier === 0)!;
const LOCKED_REGION = REGION_SEEDS.find((r) => r.unlockTier > 0)!;

const input = (over: Partial<Parameters<typeof createPlayerAndDojo>[1]> = {}) => ({
  handle: 'tomoe',
  headmasterName: 'Tomoe Sasaki',
  nationality: 'Japanese',
  dojoName: 'The Low Gate',
  regionSlug: OPEN_REGION.slug,
  ...over,
});

beforeAll(async () => {
  harness = await createHarness();
  ctx = { db: harness.db };
  console.log(`[onboarding] backend: ${harness.kind}`);
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  await harness.db.insert(users).values([
    { id: USER_A, email: 'a@example.test' },
    { id: USER_B, email: 'b@example.test' },
    { id: USER_C, email: 'c@example.test' },
  ]);
  await harness.db.insert(regions).values(
    [OPEN_REGION, LOCKED_REGION].map((r) => ({
      slug: r.slug,
      name: r.name,
      description: r.description,
      recruitQuality: r.recruitQuality,
      scrollFamilies: r.scrollFamilies,
      characterVector: r.characterVector,
      unlockTier: r.unlockTier,
    })),
  );
});

describe('the happy path', () => {
  it('creates the player and the dojo together', async () => {
    const result = await createPlayerAndDojo(USER_A, input(), T0, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.dojo.name).toBe('The Low Gate');
    expect(result.state.player.handle).toBe('tomoe');
    expect(result.state.dojo.region.slug).toBe(OPEN_REGION.slug);

    // And it is readable back through the normal path.
    const loaded = await findDojoState(USER_A, T0, ctx);
    expect(loaded?.dojo.id).toBe(result.state.dojo.id);
  });

  it('leaves nothing behind when it fails', async () => {
    // Both rows or neither — a player without a dojo is a state the UI has no
    // screen for, which is why they share a transaction.
    await createPlayerAndDojo(USER_A, input({ regionSlug: 'does-not-exist' }), T0, ctx);

    expect(await harness.db.select().from(players)).toHaveLength(0);
    expect(await harness.db.select().from(dojos)).toHaveLength(0);
  });
});

describe('the failure that caused the redirect loop', () => {
  it('reports a session naming a deleted user as stale_session', async () => {
    // Exactly what happened live: the users row was removed while a JWT naming
    // it was still valid. Sessions are JWTs and outlive their user row.
    await harness.db.delete(users).where(eq(users.id, USER_A));

    const result = await createPlayerAndDojo(USER_A, input(), T0, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('stale_session');
    // The regression, pinned: reporting this as already_exists sends the user
    // to /dojo, which has no dojo to show, which sends them back to /create.
    expect(result.reason).not.toBe('already_exists');
  });

  it('and there is genuinely no dojo to redirect them to', async () => {
    await harness.db.delete(users).where(eq(users.id, USER_A));
    await createPlayerAndDojo(USER_A, input(), T0, ctx);

    // This is the second half of the loop. If the action had believed
    // 'already_exists', /dojo would find nothing and bounce back to /create.
    expect(await findDojoState(USER_A, T0, ctx)).toBeNull();
  });
});

describe('genuine duplicates', () => {
  it('reports a second dojo for the same user as already_exists', async () => {
    const first = await createPlayerAndDojo(USER_A, input(), T0, ctx);
    expect(first.ok).toBe(true);

    const second = await createPlayerAndDojo(USER_A, input({ handle: 'tomoe2' }), T0, ctx);

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected failure');
    expect(second.reason).toBe('already_exists');
  });

  it('and in that case a dojo really does exist to send them to', async () => {
    await createPlayerAndDojo(USER_A, input(), T0, ctx);
    await createPlayerAndDojo(USER_A, input({ handle: 'tomoe2' }), T0, ctx);

    // The distinction from stale_session, and why the action re-checks before
    // redirecting rather than trusting the classification.
    expect(await findDojoState(USER_A, T0, ctx)).not.toBeNull();
  });

  it('reports a handle taken by someone else as handle_taken', async () => {
    await createPlayerAndDojo(USER_A, input({ handle: 'tomoe' }), T0, ctx);

    const clash = await createPlayerAndDojo(USER_B, input({ handle: 'tomoe' }), T0, ctx);

    expect(clash.ok).toBe(false);
    if (clash.ok) throw new Error('expected failure');
    expect(clash.reason).toBe('handle_taken');
  });

  it('treats a handle differing only by case as taken', async () => {
    // Enforced by players_handle_lower_idx, separately from the plain unique
    // constraint, and it must classify the same way.
    await createPlayerAndDojo(USER_A, input({ handle: 'tomoe' }), T0, ctx);

    const clash = await createPlayerAndDojo(USER_B, input({ handle: 'ToMoE' }), T0, ctx);

    expect(clash.ok).toBe(false);
    if (clash.ok) throw new Error('expected failure');
    expect(clash.reason).toBe('handle_taken');
  });
});

describe('region gating', () => {
  it('refuses a region that does not exist', async () => {
    const result = await createPlayerAndDojo(USER_A, input({ regionSlug: 'atlantis' }), T0, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('unknown_region');
  });

  it('refuses a region that exists but is not open at Backyard tier', async () => {
    // The form only offers unlockTier 0, so reaching this means a crafted
    // request — server authority, SPEC §2.2.
    const result = await createPlayerAndDojo(
      USER_A,
      input({ regionSlug: LOCKED_REGION.slug }),
      T0,
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('unknown_region');
  });
});

describe('resources at creation', () => {
  it('starts the regen clock at the creation instant, not before it', async () => {
    const result = await createPlayerAndDojo(USER_A, input(), T0, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    // A new dojo must not begin with a partially elapsed tick.
    expect(new Date(result.state.dojo.energy.updatedAt).getTime()).toBe(T0.getTime());
    expect(result.state.dojo.energy.msUntilNext).toBe(result.state.dojo.energy.regenMs);
  });

  it('gives the new dojo its protection window', async () => {
    const result = await createPlayerAndDojo(USER_A, input(), T0, ctx);
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.dojo.shieldUntil).not.toBeNull();
    expect(new Date(result.state.dojo.shieldUntil!).getTime()).toBeGreaterThan(T0.getTime());
  });
});
