/**
 * The Energy spend path — SPEC §2.1.
 *
 *   "On any spend: recompute, deduct, write back both value and a
 *    *floor-adjusted* timestamp so partial ticks aren't lost."
 *
 * `tests/unit/resources.test.ts` already proves the arithmetic. What it cannot
 * prove is that the arithmetic survives contact with the database: that the
 * floor-adjusted timestamp is the one actually persisted, and that two
 * simultaneous spends cannot both succeed against the same balance.
 *
 * These run `spendEnergy` itself rather than a reimplementation. A hand-rolled
 * copy of the compare-and-swap in the test would be exactly the kind of thing
 * that is correct in the test and wrong in the shipped code.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { ENERGY_REGEN_MS, MS_PER_MINUTE, STARTING_ENERGY } from '@/lib/constants';
import { dojos, regions, users } from '@/lib/db/schema';
import { createPlayerAndDojo, findDojoState, spendEnergy } from '@/lib/repo/dojo';
import { REGION_SEEDS } from '@/lib/db/seed/regions';

import { createHarness, USER_A, USER_B, type Harness } from './harness';

let harness: Harness;
let ctx: { db: Harness['db'] };
let dojoId: string;

/** A fixed instant. Nothing here depends on the real clock. */
const T0 = new Date('2026-03-01T12:00:00.000Z');
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

beforeAll(async () => {
  harness = await createHarness();
  ctx = { db: harness.db };
  console.log(`[spend] backend: ${harness.kind}`);
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  await harness.db.insert(users).values([
    { id: USER_A, email: 'a@example.test' },
    { id: USER_B, email: 'b@example.test' },
  ]);

  const seed = REGION_SEEDS[0];
  await harness.db.insert(regions).values({
    slug: seed.slug,
    name: seed.name,
    description: seed.description,
    recruitQuality: seed.recruitQuality,
    scrollFamilies: seed.scrollFamilies,
    characterVector: seed.characterVector,
    unlockTier: seed.unlockTier,
  });

  const created = await createPlayerAndDojo(
    USER_A,
    {
      handle: 'spender',
      headmasterName: 'Spender',
      nationality: 'Japanese',
      dojoName: 'Spend Hall',
      regionSlug: seed.slug,
    },
    T0,
    ctx,
  );
  if (!created.ok) throw new Error(`fixture failed: ${created.reason}`);
  dojoId = created.state.dojo.id;
});

/** Read the row as the owner, bypassing the view layer entirely. */
async function storedEnergy() {
  const [row] = await harness.db
    .select({ energy: dojos.energy, updatedAt: dojos.energyUpdatedAt })
    .from(dojos)
    .where(eq(dojos.id, dojoId));
  return row;
}

describe('a new dojo starts its regen clock at creation', () => {
  it('stores the starting Energy against the creation instant', async () => {
    const row = await storedEnergy();
    expect(row.energy).toBe(STARTING_ENERGY);
    expect(row.updatedAt.getTime()).toBe(T0.getTime());
  });
});

describe('spending persists the floor-adjusted timestamp, not `now`', () => {
  it('leaves the timestamp untouched when no whole tick has elapsed', async () => {
    // Five minutes into a six minute tick — SPEC §7 test 2, at the database.
    const result = await spendEnergy(USER_A, 4, at(5 * MS_PER_MINUTE), ctx);
    expect(result.ok).toBe(true);

    const row = await storedEnergy();
    expect(row.energy).toBe(STARTING_ENERGY - 4);
    expect(row.updatedAt.getTime()).toBe(T0.getTime());
  });

  it('delivers the next point one minute later, not six', async () => {
    await spendEnergy(USER_A, 4, at(5 * MS_PER_MINUTE), ctx);

    // The tick that was already 5/6 done completes on schedule.
    const state = await findDojoState(USER_A, at(6 * MS_PER_MINUTE), ctx);
    expect(state?.dojo.energy.value).toBe(STARTING_ENERGY - 4 + 1);
  });

  it('advances by whole ticks only, banking the remainder', async () => {
    // 14 minutes = 2 whole ticks + 2 minutes of remainder.
    const result = await spendEnergy(USER_A, 5, at(14 * MS_PER_MINUTE), ctx);
    expect(result.ok).toBe(true);

    const row = await storedEnergy();
    expect(row.energy).toBe(STARTING_ENERGY + 2 - 5);
    expect(row.updatedAt.getTime()).toBe(T0.getTime() + 2 * ENERGY_REGEN_MS);
  });
});

describe('affordability is decided after regen, not before', () => {
  it('refuses a spend larger than the balance and changes nothing', async () => {
    const result = await spendEnergy(USER_A, STARTING_ENERGY + 1, T0, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('insufficient');
    expect(result.available).toBe(STARTING_ENERGY);

    const row = await storedEnergy();
    expect(row.energy).toBe(STARTING_ENERGY);
    expect(row.updatedAt.getTime()).toBe(T0.getTime());
  });

  it('allows the same spend once enough time has passed', async () => {
    const result = await spendEnergy(USER_A, STARTING_ENERGY + 1, at(ENERGY_REGEN_MS), ctx);
    expect(result.ok).toBe(true);

    const row = await storedEnergy();
    expect(row.energy).toBe(0);
  });
});

describe('a user with no dojo', () => {
  it('is told so rather than throwing', async () => {
    const result = await spendEnergy(USER_B, 1, T0, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('no_dojo');
  });
});

describe('the compare-and-swap', () => {
  it('refuses a write whose observed value is stale', async () => {
    // Reproduces the interleaving directly: read the row, let something else
    // change it, then attempt the write the reader would have made. This is
    // what `spendEnergy` guards against, expressed without needing two
    // connections — so it runs on every backend including in-process Postgres.
    const observed = await storedEnergy();

    await harness.db
      .update(dojos)
      .set({ energy: observed.energy - 3 })
      .where(eq(dojos.id, dojoId));

    const written = await harness.db
      .update(dojos)
      .set({ energy: observed.energy - 1, energyUpdatedAt: observed.updatedAt })
      .where(
        // The production guard, verbatim: the id, AND both the value and the
        // timestamp that were read. It must be one `and()` — chaining `.where()`
        // twice in drizzle REPLACES the predicate rather than combining it, and
        // this test passed for that wrong reason before it was corrected.
        and(
          eq(dojos.id, dojoId),
          eq(dojos.energy, observed.energy),
          eq(dojos.energyUpdatedAt, observed.updatedAt),
        ),
      )
      .returning({ id: dojos.id });

    expect(written).toHaveLength(0);

    const after = await storedEnergy();
    expect(after.energy).toBe(observed.energy - 3);
  });

  it.skipIf(process.env.TEST_DATABASE_URL === undefined || process.env.TEST_DATABASE_URL === '')(
    'lets exactly one of two simultaneous full-balance spends succeed',
    async () => {
      // Needs genuine concurrency, so it only runs against a real server.
      // In-process Postgres has a single connection and would serialise these
      // into two ordinary sequential spends, proving nothing.
      const [first, second] = await Promise.all([
        spendEnergy(USER_A, STARTING_ENERGY, T0, ctx),
        spendEnergy(USER_A, STARTING_ENERGY, T0, ctx),
      ]);

      const succeeded = [first, second].filter((r) => r.ok);
      expect(succeeded, 'exactly one spend may win').toHaveLength(1);

      const loser = [first, second].find((r) => !r.ok);
      expect(loser && !loser.ok && loser.reason).toMatch(/contended|insufficient/);

      // And the balance reflects one spend, not two and not zero.
      const row = await storedEnergy();
      expect(row.energy).toBe(0);
    },
  );
});
