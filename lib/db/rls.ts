/**
 * Request-scoped database access under row-level security. SPEC §7 test 12.
 *
 * HOW THE ISOLATION ACTUALLY WORKS
 *
 * The application connects as the database owner. In Postgres the owner of a
 * table bypasses its RLS policies, so merely enabling RLS would achieve
 * precisely nothing. Two things close that:
 *
 *   1. Every player-owned table is declared `FORCE ROW LEVEL SECURITY`, which
 *      subjects the owner to its own policies.
 *   2. Every request-scoped statement runs after `SET LOCAL ROLE app_user`.
 *      `app_user` owns nothing, holds no BYPASSRLS attribute, and is revoked
 *      from the auth tables entirely.
 *
 * Belt and braces on purpose, and not theoretically. Neon's `neondb_owner`
 * genuinely holds BYPASSRLS — `npm run verify:rls` prints it — so (1) alone
 * protects nothing here, and (2) alone is defeated by anyone who forgets the
 * SET ROLE.
 *
 * `SET LOCAL` and `set_config(..., true)` are both scoped to the transaction
 * and unwound on COMMIT or ROLLBACK, so a pooled connection cannot leak one
 * player's identity into the next request that borrows it.
 *
 * WHAT THIS DOES NOT STOP
 *
 * Postgres authorises SET ROLE against the SESSION user, not the current one.
 * When the pool connects as the owner, code running inside `withPlayer()` can
 * therefore issue `SET ROLE neondb_owner` and climb back out. There is a test
 * that demonstrates exactly this rather than pretending otherwise.
 *
 * That matters only to code that can execute arbitrary SQL — which, given every
 * query here is parameterised through drizzle, means a SQL injection bug. So
 * this design defends against the realistic failure (a server action that
 * forgets an ownership check) and not against the exotic one.
 *
 * To close it too, set APP_DATABASE_URL: `npm run db:app-role` provisions
 * `app_user` as a login role, the session user becomes `app_user`, and there is
 * no longer anything to climb back to. Recommended for production, optional for
 * local work.
 */

import { sql, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';

import { appDb, ownerDb } from './client';
import type * as schema from './schema';

type Schema = typeof schema;
type SchemaRelations = ExtractTablesWithRelations<Schema>;

/**
 * Any Postgres-backed drizzle handle. Loose on the driver by design: the
 * integration suite runs these exact functions against PGlite, so the wrapper
 * under test is the wrapper that ships rather than a reimplementation of it.
 */
export type AnyDatabase = PgDatabase<PgQueryResultHKT, Schema, SchemaRelations>;

/** A transaction already scoped to one player. Never escapes the callback. */
export type ScopedTx = PgTransaction<PgQueryResultHKT, Schema, SchemaRelations>;

/** The Postgres role every request-scoped statement runs as. */
export const APP_ROLE = 'app_user';

/** The GUC that carries the caller's identity into the RLS policies. */
export const USER_ID_SETTING = 'app.user_id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Apply the player context to an open transaction. */
async function enterPlayerContext(tx: ScopedTx, userId: string | null): Promise<void> {
  // Identity first, then demote the role. Both are transaction-local, so the
  // connection returns to the pool with neither still set.
  await tx.execute(sql`select set_config(${USER_ID_SETTING}, ${userId ?? ''}, true)`);
  await tx.execute(sql`select set_config('role', ${APP_ROLE}, true)`);
}

/**
 * Run `fn` on `db` with the connection demoted to `app_user` and every RLS
 * policy evaluating against `userId`.
 */
export async function withPlayerOn<T>(
  db: AnyDatabase,
  userId: string,
  fn: (tx: ScopedTx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(userId)) {
    // Not merely a validation nicety: this value is about to become the
    // identity that the entire policy set trusts. Refuse anything unexpected.
    throw new TypeError(`withPlayer requires a uuid user id, received ${JSON.stringify(userId)}`);
  }
  return db.transaction(async (tx) => {
    await enterPlayerContext(tx as ScopedTx, userId);
    return fn(tx as ScopedTx);
  });
}

/** Run `fn` on `db` as `app_user` with no identity — world-readable rows only. */
export async function withAnonymousOn<T>(
  db: AnyDatabase,
  fn: (tx: ScopedTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await enterPlayerContext(tx as ScopedTx, null);
    return fn(tx as ScopedTx);
  });
}

/**
 * The ONLY sanctioned path to a player-owned table from application code.
 * Anything reached through `ownerDb()` directly is running with RLS disengaged.
 */
export async function withPlayer<T>(userId: string, fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return withPlayerOn(appDb() as unknown as AnyDatabase, userId, fn);
}

/**
 * Run `fn` as `app_user` with no identity set. Only world-readable rows are
 * visible — regions and branches. Used before a player exists, e.g. the region
 * list on the dojo creation screen.
 */
export async function withAnonymous<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return withAnonymousOn(appDb() as unknown as AnyDatabase, fn);
}

/**
 * Escape hatch: runs as the owner, with RLS bypassed for any role holding
 * BYPASSRLS and constrained only by FORCE RLS otherwise. This is the migration
 * and seeding path. The name is deliberately unpleasant so it stands out in a
 * diff.
 */
export async function unsafeWithoutRls<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return (ownerDb() as unknown as AnyDatabase).transaction((tx) => fn(tx as ScopedTx));
}

/**
 * Ask the database what identity it currently believes it has. Used by the
 * integration suite and `npm run verify:rls` to prove the context actually
 * applied rather than silently no-opping — a test that passes because every
 * query fails is worth nothing.
 */
export async function describeContext(
  tx: ScopedTx,
): Promise<{ role: string; userId: string | null }> {
  const result = await tx.execute<{ role: string; user_id: string | null }>(
    sql`select current_user as role, nullif(current_setting(${USER_ID_SETTING}, true), '') as user_id`,
  );
  const row = (result as unknown as { rows: { role: string; user_id: string | null }[] }).rows[0];
  return { role: row.role, userId: row.user_id };
}
