/**
 * SPEC §7 test 12 — "RLS blocks a player from mutating another player's dojo,
 * students, or branches via direct API call."
 *
 * WHY THIS TEST LOOKS DIFFERENT FROM THE SPEC'S WORDING
 *
 * The spec assumed Supabase, where PostgREST exposes the tables directly and
 * "direct API call" means curl against the database. On Neon there is no such
 * surface: every query goes through this application. Testing the HTTP layer
 * would therefore only prove that our own route handlers check ownership —
 * which is an application bug away from being false, and is not what the spec
 * was trying to pin down.
 *
 * So the test is pushed one layer lower, where it is stronger. It runs the real
 * migrations, takes the real `withPlayer()` wrapper the application uses, and
 * asks Postgres directly whether player A can touch player B's rows. If someone
 * later forgets an ownership check in a server action, these policies are what
 * stops it, and this is the test that proves they do.
 *
 * Every assertion is paired with a positive control. A test suite where the
 * database refuses everything would pass a "cannot mutate" test while being
 * entirely broken, so each denial is accompanied by the same operation
 * succeeding against the caller's own rows.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';

import { STARTING_ENERGY, STARTING_FOCUS, HEADMASTER_ATTRIBUTE_START } from '@/lib/constants';
import { branches, challenges, dojos, players, regions, students, users } from '@/lib/db/schema';
import { describeContext, withAnonymousOn, withPlayerOn } from '@/lib/db/rls';
import { REGION_SEEDS } from '@/lib/db/seed/regions';
import { emptyStyleVector } from '@/lib/game/style';

import {
  createHarness,
  studentDefaults,
  USER_A,
  USER_B,
  USER_C,
  type Harness,
  type Tenant,
} from './harness';

let harness: Harness;
let regionId: string;
let alice: Tenant;
let bob: Tenant;

const POLICY_VIOLATION = /row-level security|violates row-level security policy/i;
const PERMISSION_DENIED = /permission denied/i;

/**
 * Drizzle wraps driver errors: `error.message` is only "Failed query: ...", and
 * the Postgres message that says *why* lives on `error.cause`. Asserting on
 * `.message` alone matches nothing and — worse — a test written that way still
 * fails loudly rather than silently, but for the wrong reason. Flatten the
 * whole chain before matching.
 */
function messageChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (!(current instanceof Error)) {
      parts.push(String(current));
      break;
    }
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' <- ');
}

/**
 * Assert the database refused a statement, and refused it for the stated
 * reason. Returns the flattened error so a caller can assert further.
 */
async function expectDenied(attempt: Promise<unknown>, pattern: RegExp): Promise<string> {
  let caught: unknown;
  let resolved = false;
  try {
    await attempt;
    resolved = true;
  } catch (error) {
    caught = error;
  }
  if (resolved) {
    throw new Error('expected the database to refuse this statement, but it succeeded');
  }
  const chain = messageChain(caught);
  expect(chain, `error did not match ${pattern}`).toMatch(pattern);
  return chain;
}

beforeAll(async () => {
  harness = await createHarness();
  // Printed so a green run cannot be mistaken for coverage it does not have.
  console.log(`[rls] backend: ${harness.kind}`);
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();

  // Auth rows and reference data are written by the owner. `users` carries no
  // RLS (the Auth.js adapter owns it) and `regions` has RLS enabled but not
  // forced, so seeding works identically on PGlite and on real Neon.
  await harness.db.insert(users).values([
    { id: USER_A, email: 'alice@example.test', name: 'Alice' },
    { id: USER_B, email: 'bob@example.test', name: 'Bob' },
    { id: USER_C, email: 'carol@example.test', name: 'Carol' },
  ]);

  const seed = REGION_SEEDS[0];
  const [region] = await harness.db
    .insert(regions)
    .values({
      slug: seed.slug,
      name: seed.name,
      description: seed.description,
      recruitQuality: seed.recruitQuality,
      scrollFamilies: seed.scrollFamilies,
      characterVector: seed.characterVector,
      unlockTier: seed.unlockTier,
    })
    .returning({ id: regions.id });
  regionId = region.id;

  alice = await createTenant(USER_A, 'alice');
  bob = await createTenant(USER_B, 'bob');
});

/**
 * Builds a full tenant *through the RLS path* rather than around it. If the
 * WITH CHECK clauses were wrong, this would fail outright — so fixture setup is
 * itself a positive control on every insert policy.
 */
async function createTenant(userId: string, handle: string): Promise<Tenant> {
  return withPlayerOn(harness.db, userId, async (tx) => {
    const [player] = await tx
      .insert(players)
      .values({
        userId,
        handle,
        headmasterName: `${handle} sensei`,
        nationality: 'Japanese',
      })
      .returning({ id: players.id });

    const now = new Date();
    const [dojo] = await tx
      .insert(dojos)
      .values({
        playerId: player.id,
        name: `${handle} dojo`,
        regionId,
        energy: STARTING_ENERGY,
        energyUpdatedAt: now,
        focus: STARTING_FOCUS,
        focusUpdatedAt: now,
        styleVector: emptyStyleVector(),
      })
      .returning({ id: dojos.id });

    const [student] = await tx
      .insert(students)
      .values(studentDefaults(dojo.id, `${handle} student`))
      .returning({ id: students.id });

    const [branch] = await tx
      .insert(branches)
      .values({
        rootDojoId: dojo.id,
        parentDojoId: dojo.id,
        founderName: `${handle} graduate`,
        generation: 1,
        regionId,
        styleVector: emptyStyleVector(),
      })
      .returning({ id: branches.id });

    return {
      userId,
      handle,
      playerId: player.id,
      dojoId: dojo.id,
      studentId: student.id,
      branchId: branch.id,
    };
  });
}

// ---------------------------------------------------------------------------

describe('the security context actually applies', () => {
  it('demotes the connection to app_user and carries the caller identity', async () => {
    const ctx = await withPlayerOn(harness.db, USER_A, (tx) => describeContext(tx));
    expect(ctx.role).toBe('app_user');
    expect(ctx.userId).toBe(USER_A);
  });

  it('unwinds the role and the identity when the transaction ends', async () => {
    await withPlayerOn(harness.db, USER_A, async (tx) => {
      expect((await describeContext(tx)).role).toBe('app_user');
    });
    // A pooled connection must not carry one request's identity into the next.
    const after = await harness.db.execute<{ role: string; uid: string | null }>(
      sql`select current_user as role, nullif(current_setting('app.user_id', true), '') as uid`,
    );
    const row = (after as unknown as { rows: { role: string; uid: string | null }[] }).rows[0];
    expect(row.role).not.toBe('app_user');
    expect(row.uid).toBeNull();
  });

  it('refuses an identity that is not a uuid', async () => {
    await expectDenied(
      withPlayerOn(harness.db, "' or true --", async () => null),
      /uuid/i,
    );
  });

  it('has row-level security enabled and forced on every player-owned table', async () => {
    const result = await harness.db.execute<{
      table_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      policy_count: string | number;
    }>(sql`select * from app.rls_status()`);
    const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
    const status = new Map(rows.map((r) => [r.table_name as string, r]));

    const owned = [
      'players',
      'dojos',
      'students',
      'branches',
      'scrolls',
      'techniques',
      'facilities',
      'challenges',
      'drill_log',
    ];
    for (const table of owned) {
      const row = status.get(table);
      expect(row, `${table} missing from pg_class`).toBeDefined();
      expect(row!.rls_enabled, `${table} has RLS disabled`).toBe(true);
      expect(row!.rls_forced, `${table} is not FORCE ROW LEVEL SECURITY`).toBe(true);
      expect(Number(row!.policy_count), `${table} has no policies`).toBeGreaterThan(0);
    }

    // Regions are world-readable reference data: RLS on, FORCE deliberately off
    // so migrations and seeding can write them.
    expect(status.get('regions')!.rls_enabled).toBe(true);
    expect(status.get('regions')!.rls_forced).toBe(false);
  });
});

describe("SPEC test 12 — a player cannot reach another player's dojo", () => {
  it('cannot see it', async () => {
    await withPlayerOn(harness.db, USER_A, async (tx) => {
      const mine = await tx.select().from(dojos);
      expect(mine).toHaveLength(1);
      expect(mine[0].id).toBe(alice.dojoId);

      const theirs = await tx.select().from(dojos).where(eq(dojos.id, bob.dojoId));
      expect(theirs).toHaveLength(0);
    });
  });

  it('cannot update it', async () => {
    await withPlayerOn(harness.db, USER_A, async (tx) => {
      // Positive control first: the same statement against her own dojo works.
      const own = await tx
        .update(dojos)
        .set({ name: 'renamed by owner' })
        .where(eq(dojos.id, alice.dojoId))
        .returning({ id: dojos.id });
      expect(own).toHaveLength(1);

      const theirs = await tx
        .update(dojos)
        .set({ name: 'renamed by attacker', tuition: 999_999 })
        .where(eq(dojos.id, bob.dojoId))
        .returning({ id: dojos.id });
      expect(theirs).toHaveLength(0);
    });

    // And it really is untouched, not merely unreported.
    const [row] = await harness.db.select().from(dojos).where(eq(dojos.id, bob.dojoId));
    expect(row.name).toBe('bob dojo');
    expect(row.tuition).not.toBe(999_999);
  });

  it('cannot delete it', async () => {
    await withPlayerOn(harness.db, USER_A, async (tx) => {
      const deleted = await tx
        .delete(dojos)
        .where(eq(dojos.id, bob.dojoId))
        .returning({ id: dojos.id });
      expect(deleted).toHaveLength(0);
    });
    const survivors = await harness.db.select().from(dojos).where(eq(dojos.id, bob.dojoId));
    expect(survivors).toHaveLength(1);
  });

  it('cannot drain its resources with an unfiltered update', async () => {
    // The blunt attack: no WHERE clause at all. RLS narrows it to her own row.
    await withPlayerOn(harness.db, USER_A, async (tx) => {
      const touched = await tx.update(dojos).set({ energy: 0 }).returning({ id: dojos.id });
      expect(touched).toHaveLength(1);
      expect(touched[0].id).toBe(alice.dojoId);
    });
    const [victim] = await harness.db.select().from(dojos).where(eq(dojos.id, bob.dojoId));
    expect(victim.energy).toBe(STARTING_ENERGY);
  });

  it('cannot move its own dojo under another player', async () => {
    // WITH CHECK, not USING: the row is hers to update, but not to re-home.
    await expectDenied(
      withPlayerOn(harness.db, USER_A, (tx) =>
        tx.update(dojos).set({ playerId: bob.playerId }).where(eq(dojos.id, alice.dojoId)),
      ),
      POLICY_VIOLATION,
    );
  });
});

describe('SPEC test 12 — students', () => {
  it("cannot see or modify another player's students", async () => {
    await withPlayerOn(harness.db, USER_A, async (tx) => {
      const visible = await tx.select().from(students);
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe(alice.studentId);

      const stolen = await tx
        .update(students)
        .set({ loyalty: 0 })
        .where(eq(students.id, bob.studentId))
        .returning({ id: students.id });
      expect(stolen).toHaveLength(0);

      const deleted = await tx
        .delete(students)
        .where(eq(students.id, bob.studentId))
        .returning({ id: students.id });
      expect(deleted).toHaveLength(0);
    });
  });

  it("cannot plant a student in another player's dojo", async () => {
    await expectDenied(
      withPlayerOn(harness.db, USER_A, (tx) =>
        tx.insert(students).values(studentDefaults(bob.dojoId, 'mole')),
      ),
      POLICY_VIOLATION,
    );

    const bobsRoster = await harness.db
      .select()
      .from(students)
      .where(eq(students.dojoId, bob.dojoId));
    expect(bobsRoster).toHaveLength(1);
  });

  it("cannot transfer another player's student into its own dojo", async () => {
    // Poaching is a Phase 5 mechanic with its own rules (GDD §8.4). It is not
    // an UPDATE any client can issue.
    await withPlayerOn(harness.db, USER_A, async (tx) => {
      const moved = await tx
        .update(students)
        .set({ dojoId: alice.dojoId })
        .where(eq(students.id, bob.studentId))
        .returning({ id: students.id });
      expect(moved).toHaveLength(0);
    });
  });

  it('can still manage its own roster', async () => {
    await withPlayerOn(harness.db, USER_A, async (tx) => {
      const updated = await tx
        .update(students)
        .set({ loyalty: 42 })
        .where(eq(students.id, alice.studentId))
        .returning({ loyalty: students.loyalty });
      expect(updated).toEqual([{ loyalty: 42 }]);

      const added = await tx
        .insert(students)
        .values(studentDefaults(alice.dojoId, 'new recruit'))
        .returning({ id: students.id });
      expect(added).toHaveLength(1);
    });
  });
});

describe('SPEC test 12 — branches', () => {
  it('are world-readable, because a lineage holds visible territory', async () => {
    await withPlayerOn(harness.db, USER_A, async (tx) => {
      const all = await tx.select().from(branches);
      expect(all.map((b) => b.id).sort()).toEqual([alice.branchId, bob.branchId].sort());
    });
  });

  it('cannot be modified or destroyed by anyone but their root dojo', async () => {
    await withPlayerOn(harness.db, USER_A, async (tx) => {
      const own = await tx
        .update(branches)
        .set({ patronized: true })
        .where(eq(branches.id, alice.branchId))
        .returning({ id: branches.id });
      expect(own).toHaveLength(1);

      const theirs = await tx
        .update(branches)
        .set({ status: 'defected', patronized: false })
        .where(eq(branches.id, bob.branchId))
        .returning({ id: branches.id });
      expect(theirs).toHaveLength(0);

      const deleted = await tx
        .delete(branches)
        .where(eq(branches.id, bob.branchId))
        .returning({ id: branches.id });
      expect(deleted).toHaveLength(0);
    });

    const [survivor] = await harness.db
      .select()
      .from(branches)
      .where(eq(branches.id, bob.branchId));
    expect(survivor.status).toBe('active');
  });

  it("cannot be grafted onto another player's lineage", async () => {
    await expectDenied(
      withPlayerOn(harness.db, USER_A, (tx) =>
        tx.insert(branches).values({
          rootDojoId: bob.dojoId,
          parentDojoId: bob.dojoId,
          founderName: 'impostor',
          generation: 1,
          regionId,
          styleVector: emptyStyleVector(),
        }),
      ),
      POLICY_VIOLATION,
    );
  });
});

describe('SPEC test 12 — the player row itself', () => {
  it('cannot be read or edited by another user', async () => {
    await withPlayerOn(harness.db, USER_A, async (tx) => {
      const visible = await tx.select().from(players);
      expect(visible).toHaveLength(1);
      expect(visible[0].userId).toBe(USER_A);

      const boosted = await tx
        .update(players)
        .set({ presence: 99 })
        .where(eq(players.id, bob.playerId))
        .returning({ id: players.id });
      expect(boosted).toHaveLength(0);
    });
  });

  it('cannot be forged for another user id', async () => {
    await expectDenied(
      withPlayerOn(harness.db, USER_A, (tx) =>
        tx.insert(players).values({
          userId: USER_C,
          handle: 'forged',
          headmasterName: 'forged',
          nationality: 'Japanese',
        }),
      ),
      POLICY_VIOLATION,
    );
  });

  it('cannot be reassigned to another user id', async () => {
    await expectDenied(
      withPlayerOn(harness.db, USER_A, (tx) =>
        tx.update(players).set({ userId: USER_C }).where(eq(players.id, alice.playerId)),
      ),
      POLICY_VIOLATION,
    );
  });
});

describe('SPEC test 12 — challenge history is append-only and participant-scoped', () => {
  beforeEach(async () => {
    await withPlayerOn(harness.db, USER_A, (tx) =>
      tx.insert(challenges).values({
        attackerDojoId: alice.dojoId,
        defenderDojoId: bob.dojoId,
        seed: 1234n,
        attackerSnapshot: { squad: [] },
        defenderSnapshot: { squad: [] },
        result: 'attacker_win',
      }),
    );
  });

  it('is visible to both the attacker and the defender', async () => {
    const asAttacker = await withPlayerOn(harness.db, USER_A, (tx) => tx.select().from(challenges));
    const asDefender = await withPlayerOn(harness.db, USER_B, (tx) => tx.select().from(challenges));
    expect(asAttacker).toHaveLength(1);
    expect(asDefender).toHaveLength(1);
  });

  it('is invisible to an uninvolved user', async () => {
    const asOutsider = await withPlayerOn(harness.db, USER_C, (tx) => tx.select().from(challenges));
    expect(asOutsider).toHaveLength(0);
  });

  it("cannot be fabricated in someone else's name", async () => {
    await expectDenied(
      withPlayerOn(harness.db, USER_A, (tx) =>
        tx.insert(challenges).values({
          attackerDojoId: bob.dojoId,
          defenderDojoId: alice.dojoId,
          seed: 9999n,
          attackerSnapshot: {},
          defenderSnapshot: {},
          result: 'defender_win',
        }),
      ),
      POLICY_VIOLATION,
    );
  });

  it('cannot be rewritten after the fact by the loser or the winner', async () => {
    // No UPDATE or DELETE policy exists, and no privilege was granted either,
    // so this fails on privilege before policy. Either way the record stands.
    await expectDenied(
      withPlayerOn(harness.db, USER_B, (tx) =>
        tx.update(challenges).set({ result: 'defender_win' }),
      ),
      /permission denied|row-level security/i,
    );
  });
});

describe('a signed-in user with no player row sees nothing', () => {
  it('reads no players, dojos, or students', async () => {
    await withPlayerOn(harness.db, USER_C, async (tx) => {
      expect(await tx.select().from(players)).toHaveLength(0);
      expect(await tx.select().from(dojos)).toHaveLength(0);
      expect(await tx.select().from(students)).toHaveLength(0);
    });
  });

  it('can still create its own player and dojo', async () => {
    // The onboarding path must remain open — this is exactly what Phase 1's
    // creation flow does.
    await withPlayerOn(harness.db, USER_C, async (tx) => {
      const [player] = await tx
        .insert(players)
        .values({
          userId: USER_C,
          handle: 'carol',
          headmasterName: 'Carol',
          nationality: 'Korean',
        })
        .returning({ id: players.id });

      const now = new Date();
      const [dojo] = await tx
        .insert(dojos)
        .values({
          playerId: player.id,
          name: 'carol dojo',
          regionId,
          energy: STARTING_ENERGY,
          energyUpdatedAt: now,
          focus: STARTING_FOCUS,
          focusUpdatedAt: now,
          styleVector: emptyStyleVector(),
        })
        .returning({ id: dojos.id });

      expect(dojo.id).toBeTruthy();
      expect(await tx.select().from(dojos)).toHaveLength(1);
    });
  });
});

describe('the anonymous context', () => {
  it('reads world data but no player data', async () => {
    await withAnonymousOn(harness.db, async (tx) => {
      expect(await tx.select().from(regions)).toHaveLength(1);
      // Branches are world-readable by design (GDD §9.2).
      expect(await tx.select().from(branches)).toHaveLength(2);

      expect(await tx.select().from(players)).toHaveLength(0);
      expect(await tx.select().from(dojos)).toHaveLength(0);
      expect(await tx.select().from(students)).toHaveLength(0);
    });
  });

  it('cannot write reference data', async () => {
    await expectDenied(
      withAnonymousOn(harness.db, (tx) =>
        tx.insert(regions).values({
          slug: 'forged-region',
          name: 'Forged',
          recruitQuality: 9,
          scrollFamilies: ['iron_fist'],
          characterVector: emptyStyleVector(),
        }),
      ),
      PERMISSION_DENIED,
    );
  });
});

describe('the auth tables are unreachable from request-scoped code', () => {
  it('denies app_user any access to users', async () => {
    await expectDenied(
      withPlayerOn(harness.db, USER_A, (tx) => tx.select().from(users)),
      PERMISSION_DENIED,
    );
  });

  it('denies app_user any access to sessions and accounts', async () => {
    await expectDenied(
      withPlayerOn(harness.db, USER_A, (tx) => tx.execute(sql`select * from public.sessions`)),
      PERMISSION_DENIED,
    );

    await expectDenied(
      withPlayerOn(harness.db, USER_A, (tx) => tx.execute(sql`select * from public.accounts`)),
      PERMISSION_DENIED,
    );
  });

  /**
   * This one asserts a LIMITATION, not a guarantee, and it is deliberate.
   *
   * SET LOCAL ROLE is not a one-way door. Postgres authorises SET ROLE against
   * the SESSION user, not the current one, so when the pool connects as the
   * owner, code inside `withPlayer()` can name that role and climb straight back
   * out. Writing this test the other way round — asserting escalation fails —
   * felt right and was simply false, which is exactly the sort of comfortable
   * fiction a security test exists to prevent.
   *
   * The exposure is narrow: reaching it requires executing arbitrary SQL, and
   * every query in the application is parameterised through drizzle. What this
   * design defends against is the realistic failure — a server action that
   * forgets an ownership check — and that it does completely.
   *
   * Set APP_DATABASE_URL (`npm run db:app-role`) and the session user becomes
   * `app_user`, at which point there is nothing left to climb back to. The test
   * flips to asserting denial automatically, because it asks the database which
   * mode it is in rather than being told.
   */
  it('documents that SET ROLE is authorised against the session user', async () => {
    const sessionUser = await withPlayerOn(harness.db, USER_A, async (tx) => {
      const result = await tx.execute(sql`select session_user as name`);
      return (result as unknown as { rows: { name: string }[] }).rows[0].name;
    });

    const attempt = () =>
      withPlayerOn(harness.db, USER_A, async (tx) => {
        await tx.execute(sql.raw(`set local role ${JSON.stringify(sessionUser)}`));
        return tx.select().from(users);
      });

    if (sessionUser === 'app_user') {
      // Hardened: the connection has nowhere to escalate to.
      const escaped = await attempt();
      expect(escaped, 'app_user must never read the auth tables').toHaveLength(0);
    } else {
      // Owner-connected: escalation succeeds. Recorded so the property is
      // visible in the suite instead of being assumed away.
      const escaped = await attempt();
      expect(
        escaped.length,
        `connected as ${sessionUser}: SET ROLE back to the session user succeeds, as Postgres specifies. ` +
          'Set APP_DATABASE_URL to close this. See lib/db/rls.ts.',
      ).toBeGreaterThan(0);
    }
  });
});

describe('identity is scoped to the transaction', () => {
  it('gives two concurrent players their own view', async () => {
    const [asAlice, asBob] = await Promise.all([
      withPlayerOn(harness.db, USER_A, (tx) =>
        tx.select({ id: dojos.id, name: dojos.name }).from(dojos),
      ),
      withPlayerOn(harness.db, USER_B, (tx) =>
        tx.select({ id: dojos.id, name: dojos.name }).from(dojos),
      ),
    ]);

    expect(asAlice).toHaveLength(1);
    expect(asBob).toHaveLength(1);
    expect(asAlice[0].id).toBe(alice.dojoId);
    expect(asBob[0].id).toBe(bob.dojoId);
  });

  it('does not leak identity into a later transaction on the same pool', async () => {
    await withPlayerOn(harness.db, USER_A, (tx) => tx.select().from(dojos));
    const asBob = await withPlayerOn(harness.db, USER_B, (tx) =>
      tx.select({ id: dojos.id }).from(dojos),
    );
    expect(asBob).toEqual([{ id: bob.dojoId }]);
  });

  it('rolls the identity back when the callback throws', async () => {
    await expect(
      withPlayerOn(harness.db, USER_A, async (tx) => {
        await tx.update(dojos).set({ name: 'half written' }).where(eq(dojos.id, alice.dojoId));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const [row] = await harness.db.select().from(dojos).where(eq(dojos.id, alice.dojoId));
    expect(row.name).toBe('alice dojo');
  });
});

describe('the headmaster defaults survive a round trip', () => {
  it('stores the spec default of 5 for every attribute', async () => {
    const [row] = await harness.db
      .select()
      .from(players)
      .where(and(eq(players.userId, USER_A), eq(players.handle, 'alice')));

    expect(row.technique).toBe(HEADMASTER_ATTRIBUTE_START);
    expect(row.mental).toBe(HEADMASTER_ATTRIBUTE_START);
    expect(row.presence).toBe(HEADMASTER_ATTRIBUTE_START);
    expect(row.stamina).toBe(HEADMASTER_ATTRIBUTE_START);
    expect(row.discipline).toBe(HEADMASTER_ATTRIBUTE_START);
  });
});
