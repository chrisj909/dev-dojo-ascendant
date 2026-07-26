/**
 * SPEC §7 test 3 — "Roster cap cannot be exceeded by recruiting, poaching, or
 * graduation reversal."
 *
 * Written before any recruitment code exists, which is the point: the cap is
 * the constraint that makes the rest of the design work, not a rule the
 * recruitment feature happens to observe.
 *
 * GDD §4.1 is unusually emphatic about why — "Hard cap. This is a dojo, not a
 * barracks. The cap is what makes each student legible and each graduation
 * meaningful — you feel the empty mat." A cap enforced only in whichever code
 * path happens to check it is not a hard cap; it is a convention. So it lives
 * in the database, and every one of the three routes the spec names is a route
 * the database refuses.
 *
 * The three routes map onto exactly two SQL operations, which is why a single
 * trigger covers all of them:
 *   recruiting          INSERT a student
 *   poaching            UPDATE a student's dojo_id      (Phase 5, GDD §8.4)
 *   graduation reversal UPDATE is_graduated back to false (Phase 6, GDD §9.1)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';

import { ROSTER_CAP_BY_TIER } from '@/lib/constants';
import { dojos, regions, students, users } from '@/lib/db/schema';
import { withPlayerOn } from '@/lib/db/rls';
import { createPlayerAndDojo } from '@/lib/repo/dojo';
import { REGION_SEEDS } from '@/lib/db/seed/regions';

import { createHarness, studentDefaults, USER_A, USER_B, type Harness } from './harness';

let harness: Harness;
let ctx: { db: Harness['db'] };
let aliceDojo: string;
let bobDojo: string;

const T0 = new Date('2026-05-01T10:00:00.000Z');
const OPEN_REGION = REGION_SEEDS.find((r) => r.unlockTier === 0)!;
const BACKYARD_CAP = ROSTER_CAP_BY_TIER[0];

const CAP_VIOLATION = /roster cap|roster is full/i;

/** Flatten drizzle's wrapper so the Postgres message is visible. */
function messageChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (!(current instanceof Error)) break;
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' <- ');
}

async function expectRefused(attempt: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown;
  let resolved = false;
  try {
    await attempt;
    resolved = true;
  } catch (error) {
    caught = error;
  }
  if (resolved) throw new Error('expected the database to refuse this, but it succeeded');
  expect(messageChain(caught)).toMatch(pattern);
}

/** Fill a dojo to exactly `count` active students, as its owner. */
async function fill(userId: string, dojoId: string, count: number): Promise<void> {
  await withPlayerOn(harness.db, userId, async (tx) => {
    for (let i = 0; i < count; i += 1) {
      await tx.insert(students).values(studentDefaults(dojoId, `student ${i + 1}`));
    }
  });
}

async function activeCount(dojoId: string): Promise<number> {
  const rows = await harness.db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.dojoId, dojoId), eq(students.isGraduated, false)));
  return rows.length;
}

beforeAll(async () => {
  harness = await createHarness();
  ctx = { db: harness.db };
  console.log(`[roster-cap] backend: ${harness.kind}`);
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
  await harness.db.insert(regions).values({
    slug: OPEN_REGION.slug,
    name: OPEN_REGION.name,
    description: OPEN_REGION.description,
    recruitQuality: OPEN_REGION.recruitQuality,
    scrollFamilies: OPEN_REGION.scrollFamilies,
    characterVector: OPEN_REGION.characterVector,
    unlockTier: OPEN_REGION.unlockTier,
  });

  const base = {
    headmasterName: 'H',
    nationality: 'Japanese',
    dojoName: 'D',
    regionSlug: OPEN_REGION.slug,
  };
  const a = await createPlayerAndDojo(USER_A, { ...base, handle: 'alice' }, T0, ctx);
  const b = await createPlayerAndDojo(USER_B, { ...base, handle: 'bob' }, T0, ctx);
  if (!a.ok || !b.ok) throw new Error('fixture failed');
  aliceDojo = a.state.dojo.id;
  bobDojo = b.state.dojo.id;
});

describe('the cap the database enforces is the cap the constants declare', () => {
  it('exposes a cap per tier matching ROSTER_CAP_BY_TIER exactly', async () => {
    // The cap lives in a reference table so the trigger can read it. That table
    // and lib/constants.ts must not drift — the same trap that let
    // STARTING_TUITION diverge from the spec for all of Phase 1.
    const result = await harness.db.execute(sql`select tier, cap from roster_caps order by tier`);
    const rows = (result as unknown as { rows: { tier: number; cap: number }[] }).rows;

    expect(rows.map((r) => Number(r.cap))).toEqual([...ROSTER_CAP_BY_TIER]);
  });
});

describe('recruiting', () => {
  it('allows exactly the cap and not one more', async () => {
    await fill(USER_A, aliceDojo, BACKYARD_CAP);
    expect(await activeCount(aliceDojo)).toBe(BACKYARD_CAP);

    await expectRefused(
      withPlayerOn(harness.db, USER_A, (tx) =>
        tx.insert(students).values(studentDefaults(aliceDojo, 'one too many')),
      ),
      CAP_VIOLATION,
    );

    expect(await activeCount(aliceDojo)).toBe(BACKYARD_CAP);
  });

  it('refuses a bulk insert that would cross the cap, rather than partly applying it', async () => {
    await fill(USER_A, aliceDojo, BACKYARD_CAP - 1);

    await expectRefused(
      withPlayerOn(harness.db, USER_A, (tx) =>
        tx
          .insert(students)
          .values([studentDefaults(aliceDojo, 'a'), studentDefaults(aliceDojo, 'b')]),
      ),
      CAP_VIOLATION,
    );

    // Not cap-1+1. The whole statement is refused.
    expect(await activeCount(aliceDojo)).toBe(BACKYARD_CAP - 1);
  });

  it("does not let one dojo fill up at another dojo's expense", async () => {
    // The count must be per dojo, not global — an obvious way to write the
    // trigger wrong and never notice with a single-tenant test.
    await fill(USER_A, aliceDojo, BACKYARD_CAP);

    const added = await withPlayerOn(harness.db, USER_B, (tx) =>
      tx.insert(students).values(studentDefaults(bobDojo, 'bob student')).returning(),
    );
    expect(added).toHaveLength(1);
  });
});

describe('graduated students leave the roster', () => {
  it('frees a place, because a graduate has left permanently', async () => {
    // GDD §9.1: a graduate "leaves the roster permanently" to found a branch.
    // Counting them would mean the cap tightens every time the player succeeds.
    await fill(USER_A, aliceDojo, BACKYARD_CAP);

    const [first] = await harness.db
      .select({ id: students.id })
      .from(students)
      .where(eq(students.dojoId, aliceDojo))
      .limit(1);

    await withPlayerOn(harness.db, USER_A, (tx) =>
      tx.update(students).set({ isGraduated: true }).where(eq(students.id, first.id)),
    );
    expect(await activeCount(aliceDojo)).toBe(BACKYARD_CAP - 1);

    const added = await withPlayerOn(harness.db, USER_A, (tx) =>
      tx.insert(students).values(studentDefaults(aliceDojo, 'replacement')).returning(),
    );
    expect(added).toHaveLength(1);
  });

  it('refuses graduation reversal that would exceed the cap', async () => {
    // SPEC §7 test 3 names this route explicitly. Graduate one, recruit a
    // replacement, then try to un-graduate — the mat is full.
    await fill(USER_A, aliceDojo, BACKYARD_CAP);
    const [first] = await harness.db
      .select({ id: students.id })
      .from(students)
      .where(eq(students.dojoId, aliceDojo))
      .limit(1);

    await withPlayerOn(harness.db, USER_A, (tx) =>
      tx.update(students).set({ isGraduated: true }).where(eq(students.id, first.id)),
    );
    await withPlayerOn(harness.db, USER_A, (tx) =>
      tx.insert(students).values(studentDefaults(aliceDojo, 'replacement')),
    );
    expect(await activeCount(aliceDojo)).toBe(BACKYARD_CAP);

    await expectRefused(
      withPlayerOn(harness.db, USER_A, (tx) =>
        tx.update(students).set({ isGraduated: false }).where(eq(students.id, first.id)),
      ),
      CAP_VIOLATION,
    );

    expect(await activeCount(aliceDojo)).toBe(BACKYARD_CAP);
  });
});

describe('poaching', () => {
  it('refuses a transfer into a full dojo', async () => {
    // Phase 5 mechanic (GDD §8.4). RLS already stops a player moving someone
    // else's student; this is the cap holding even when the move is legitimate.
    await fill(USER_A, aliceDojo, BACKYARD_CAP);
    await fill(USER_B, bobDojo, 1);

    const [bobStudent] = await harness.db
      .select({ id: students.id })
      .from(students)
      .where(eq(students.dojoId, bobDojo))
      .limit(1);

    // Performed as the owner, bypassing RLS, so the cap is what is under test
    // rather than the policy.
    await expectRefused(
      harness.db.update(students).set({ dojoId: aliceDojo }).where(eq(students.id, bobStudent.id)),
      CAP_VIOLATION,
    );

    expect(await activeCount(aliceDojo)).toBe(BACKYARD_CAP);
    expect(await activeCount(bobDojo)).toBe(1);
  });

  it('allows a transfer into a dojo with room', async () => {
    await fill(USER_A, aliceDojo, BACKYARD_CAP - 1);
    await fill(USER_B, bobDojo, 1);

    const [bobStudent] = await harness.db
      .select({ id: students.id })
      .from(students)
      .where(eq(students.dojoId, bobDojo))
      .limit(1);

    const moved = await harness.db
      .update(students)
      .set({ dojoId: aliceDojo })
      .where(eq(students.id, bobStudent.id))
      .returning({ id: students.id });

    expect(moved).toHaveLength(1);
    expect(await activeCount(aliceDojo)).toBe(BACKYARD_CAP);
  });
});

describe('tier raises the cap', () => {
  it('lets a promoted dojo hold more', async () => {
    await fill(USER_A, aliceDojo, BACKYARD_CAP);

    // Promotion is a Phase 7 mechanic; here it is just the tier column moving.
    await harness.db.update(dojos).set({ tier: 1 }).where(eq(dojos.id, aliceDojo));

    const added = await withPlayerOn(harness.db, USER_A, (tx) =>
      tx.insert(students).values(studentDefaults(aliceDojo, 'ninth')).returning(),
    );
    expect(added).toHaveLength(1);
    expect(await activeCount(aliceDojo)).toBe(ROSTER_CAP_BY_TIER[1]);
  });

  it('still refuses one past the raised cap', async () => {
    await harness.db.update(dojos).set({ tier: 1 }).where(eq(dojos.id, aliceDojo));
    await fill(USER_A, aliceDojo, ROSTER_CAP_BY_TIER[1]);

    await expectRefused(
      withPlayerOn(harness.db, USER_A, (tx) =>
        tx.insert(students).values(studentDefaults(aliceDojo, 'too many')),
      ),
      CAP_VIOLATION,
    );
  });
});
