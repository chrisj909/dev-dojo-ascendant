/**
 * Everything Phase 1 does to the database. Server-only.
 *
 * Every function here runs inside `withPlayer()`, so the row-level security
 * policies apply to every statement. That is not a substitute for checking
 * ownership — it is what catches the day somebody forgets to.
 */

import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import {
  ENERGY_REGEN_MS,
  FOCUS_REGEN_MS,
  NEW_PLAYER_SHIELD_DAYS,
  MS_PER_DAY,
  STARTING_ENERGY,
  STARTING_FOCUS,
} from '@/lib/constants';
import { dojos, players, regions, type Dojo, type Player, type Region } from '@/lib/db/schema';
import { classifyWriteError } from '@/lib/db/write-errors';
import {
  withAnonymous,
  withAnonymousOn,
  withPlayer,
  withPlayerOn,
  type AnyDatabase,
  type ScopedTx,
} from '@/lib/db/rls';
import {
  energySpec,
  focusSpec,
  msUntilFull,
  msUntilNext,
  regenerate,
  spend,
  type RegenSpec,
  type ResourceState,
} from '@/lib/game/resources';
import { emptyStyleVector } from '@/lib/game/style';

// ---------------------------------------------------------------------------
// Read models handed to the UI
// ---------------------------------------------------------------------------

/**
 * A resource as the client needs it. Both the derived value AND the timestamp
 * it was derived from are sent, so the browser can keep counting with the same
 * pure function the server used instead of guessing.
 */
export type ResourceView = {
  value: number;
  cap: number;
  /** ISO string — the floor-adjusted timestamp, not `now`. */
  updatedAt: string;
  regenMs: number;
  msUntilNext: number | null;
  msUntilFull: number | null;
};

export type DojoView = {
  id: string;
  name: string;
  tier: number;
  tuition: number;
  reputation: number;
  createdAt: string;
  shieldUntil: string | null;
  region: { id: string; name: string; slug: string; description: string };
  energy: ResourceView;
  focus: ResourceView;
};

export type PlayerView = {
  id: string;
  handle: string;
  headmasterName: string;
  nationality: string;
  technique: number;
  mental: number;
  presence: number;
  stamina: number;
  discipline: number;
};

export type DojoState = { player: PlayerView; dojo: DojoView };

function toResourceView(state: ResourceState, spec: RegenSpec, now: Date): ResourceView {
  const current = regenerate(state, now, spec);
  return {
    value: current.value,
    cap: spec.cap,
    updatedAt: current.updatedAt.toISOString(),
    regenMs: spec.regenMs,
    msUntilNext: msUntilNext(state, now, spec),
    msUntilFull: msUntilFull(state, now, spec),
  };
}

function toView(player: Player, dojo: Dojo, region: Region, now: Date): DojoState {
  return {
    player: {
      id: player.id,
      handle: player.handle,
      headmasterName: player.headmasterName,
      nationality: player.nationality,
      technique: player.technique,
      mental: player.mental,
      presence: player.presence,
      stamina: player.stamina,
      discipline: player.discipline,
    },
    dojo: {
      id: dojo.id,
      name: dojo.name,
      tier: dojo.tier,
      tuition: dojo.tuition,
      reputation: dojo.reputation,
      createdAt: dojo.createdAt.toISOString(),
      shieldUntil: dojo.shieldUntil?.toISOString() ?? null,
      region: {
        id: region.id,
        name: region.name,
        slug: region.slug,
        description: region.description,
      },
      energy: toResourceView(
        { value: dojo.energy, updatedAt: dojo.energyUpdatedAt },
        energySpec(player.stamina),
        now,
      ),
      focus: toResourceView(
        { value: dojo.focus, updatedAt: dojo.focusUpdatedAt },
        focusSpec(player.stamina),
        now,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------

/**
 * Optional database override.
 *
 * In the application this is always absent, and every function below reaches
 * the request-scoped pool through `withPlayer()`. The integration suite passes
 * its own handle so it can exercise **these exact functions** rather than a
 * reimplementation of them — which matters most for `spendEnergy`, whose
 * compare-and-swap is the kind of thing a parallel test double would get right
 * while the shipped code got it wrong.
 */
export type RepoContext = { db?: AnyDatabase };

function scoped(ctx: RepoContext | undefined) {
  const db = ctx?.db;
  return {
    player: <T>(userId: string, fn: (tx: ScopedTx) => Promise<T>) =>
      db ? withPlayerOn(db, userId, fn) : withPlayer(userId, fn),
    anonymous: <T>(fn: (tx: ScopedTx) => Promise<T>) =>
      db ? withAnonymousOn(db, fn) : withAnonymous(fn),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Regions a new dojo may be founded in. World-readable, so no player needed. */
export async function listStartingRegions(ctx?: RepoContext): Promise<Region[]> {
  return scoped(ctx).anonymous((tx) =>
    tx.select().from(regions).where(eq(regions.unlockTier, 0)).orderBy(asc(regions.recruitQuality)),
  );
}

/** The signed-in player's dojo, with resources derived as of `now`. */
export async function findDojoState(
  userId: string,
  now: Date,
  ctx?: RepoContext,
): Promise<DojoState | null> {
  return scoped(ctx).player(userId, async (tx) => {
    const rows = await tx
      .select({ player: players, dojo: dojos, region: regions })
      .from(players)
      .innerJoin(dojos, eq(dojos.playerId, players.id))
      .innerJoin(regions, eq(regions.id, dojos.regionId))
      .limit(1);

    if (rows.length === 0) return null;
    return toView(rows[0].player, rows[0].dojo, rows[0].region, now);
  });
}

/** Whether this user has completed onboarding. Cheaper than loading the state. */
export async function hasPlayer(userId: string, ctx?: RepoContext): Promise<boolean> {
  return scoped(ctx).player(userId, async (tx) => {
    const rows = await tx.select({ id: players.id }).from(players).limit(1);
    return rows.length > 0;
  });
}

export async function isHandleTaken(userId: string, handle: string): Promise<boolean> {
  // `players` is behind RLS, so a caller cannot enumerate handles by probing —
  // this select sees nothing. Uniqueness is enforced by the index instead, and
  // `createPlayerAndDojo` translates the resulting error. Kept as a fast path
  // only for the caller's OWN handle.
  return withPlayer(userId, async (tx) => {
    const rows = await tx
      .select({ id: players.id })
      .from(players)
      .where(eq(sql`lower(${players.handle})`, handle.toLowerCase()))
      .limit(1);
    return rows.length > 0;
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type CreateDojoInput = {
  handle: string;
  headmasterName: string;
  nationality: string;
  dojoName: string;
  regionSlug: string;
};

export type CreateDojoResult =
  | { ok: true; state: DojoState }
  | {
      ok: false;
      reason: 'handle_taken' | 'already_exists' | 'unknown_region' | 'stale_session' | 'unexpected';
    };

/**
 * Creates the player and their dojo in ONE transaction.
 *
 * Both or neither. A player row without a dojo is an unreachable state the UI
 * has no screen for, and the surest way to never handle it is to make it
 * impossible to create.
 */
export async function createPlayerAndDojo(
  userId: string,
  input: CreateDojoInput,
  now: Date,
  ctx?: RepoContext,
): Promise<CreateDojoResult> {
  try {
    const state = await scoped(ctx).player(userId, async (tx) => {
      const [region] = await tx
        .select()
        .from(regions)
        .where(and(eq(regions.slug, input.regionSlug), eq(regions.unlockTier, 0)))
        .limit(1);
      if (!region) throw new DomainError('unknown_region');

      const [player] = await tx
        .insert(players)
        .values({
          userId,
          handle: input.handle,
          headmasterName: input.headmasterName,
          nationality: input.nationality,
        })
        .returning();

      const [dojo] = await tx
        .insert(dojos)
        .values({
          playerId: player.id,
          name: input.dojoName,
          regionId: region.id,
          energy: STARTING_ENERGY,
          // Not "now minus a bit": a new dojo starts its regen clock exactly
          // now, so the first tick is a full interval away.
          energyUpdatedAt: now,
          focus: STARTING_FOCUS,
          focusUpdatedAt: now,
          styleVector: emptyStyleVector(),
          shieldUntil: new Date(now.getTime() + NEW_PLAYER_SHIELD_DAYS * MS_PER_DAY),
        })
        .returning();

      return toView(player, dojo, region, now);
    });
    return { ok: true, state };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, reason: error.reason };

    // Classified by SQLSTATE and exact constraint name. This used to be a regex
    // over the error message, and `/players_user_id/` matched both
    // `players_user_id_unique` and `players_user_id_users_id_fk` — reporting a
    // deleted account as "you already have a dojo" and producing a redirect
    // loop. See lib/db/write-errors.ts.
    const failure = classifyWriteError(error);
    if (failure !== 'unknown') return { ok: false, reason: failure };

    // Unrecognised. Surfaced as itself rather than guessed at — guessing is
    // exactly what caused the loop.
    console.error('[createPlayerAndDojo] unclassified write failure', error);
    return { ok: false, reason: 'unexpected' };
  }
}

export type SpendResourceResult =
  | { ok: true; state: DojoState }
  | { ok: false; reason: 'insufficient' | 'no_dojo' | 'contended'; available?: number };

/**
 * Deducts Energy with a compare-and-swap write.
 *
 * SPEC §2.1: "On any spend: recompute, deduct, write back both value and a
 * floor-adjusted timestamp so partial ticks aren't lost."
 *
 * The WHERE clause pins both the value and the timestamp we read. If a
 * concurrent request spent first, zero rows match and this reports `contended`
 * rather than overwriting the other spend — two simultaneous requests cannot
 * both succeed against the same Energy.
 *
 * Not used by a Phase 1 screen; drills arrive in Phase 2. It lives here now
 * because the spend semantics are part of the resource design the spec pins
 * down in Phase 1, and because the integration suite tests it.
 */
export async function spendEnergy(
  userId: string,
  amount: number,
  now: Date,
  ctx?: RepoContext,
): Promise<SpendResourceResult> {
  return scoped(ctx).player(userId, async (tx) => {
    const rows = await tx
      .select({ player: players, dojo: dojos, region: regions })
      .from(players)
      .innerJoin(dojos, eq(dojos.playerId, players.id))
      .innerJoin(regions, eq(regions.id, dojos.regionId))
      .limit(1);
    if (rows.length === 0) return { ok: false as const, reason: 'no_dojo' as const };

    const { player, dojo, region } = rows[0];
    const spec = energySpec(player.stamina);
    const observed: ResourceState = { value: dojo.energy, updatedAt: dojo.energyUpdatedAt };
    const result = spend(observed, amount, now, spec);

    if (!result.ok) {
      return { ok: false as const, reason: 'insufficient' as const, available: result.available };
    }

    const updated = await tx
      .update(dojos)
      .set({ energy: result.state.value, energyUpdatedAt: result.state.updatedAt })
      .where(
        and(
          eq(dojos.id, dojo.id),
          eq(dojos.energy, dojo.energy),
          eq(dojos.energyUpdatedAt, dojo.energyUpdatedAt),
        ),
      )
      .returning();

    if (updated.length === 0) return { ok: false as const, reason: 'contended' as const };

    return { ok: true as const, state: toView(player, updated[0], region, now) };
  });
}

// ---------------------------------------------------------------------------

class DomainError extends Error {
  constructor(public readonly reason: 'unknown_region') {
    super(reason);
  }
}

export const RESOURCE_REGEN_MS = { energy: ENERGY_REGEN_MS, focus: FOCUS_REGEN_MS } as const;
