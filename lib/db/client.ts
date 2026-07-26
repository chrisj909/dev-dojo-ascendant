/**
 * Database handle. Server-only.
 *
 * DRIVER CHOICE — deliberate, and a deviation from the obvious Neon setup.
 *
 * Neon's own `@neondatabase/serverless` driver has two modes. The HTTP mode is
 * the fast one, but it issues each statement as an independent request and
 * therefore cannot hold session state across statements. Our row-level security
 * design requires exactly that: `SET LOCAL ROLE` and `set_config('app.user_id')`
 * have to be visible to the queries that follow them, inside one transaction.
 * That rules HTTP mode out. What remains is Neon's WebSocket pool, which is a
 * drop-in for node-postgres and buys us very little over it.
 *
 * So we use node-postgres against Neon over TCP. The payoff is that the same
 * driver talks to a throwaway Postgres container, which is what lets SPEC §7
 * test 12 run in CI with no secrets and no Neon account. A row-level security
 * policy that is never executed in CI is a policy nobody knows is broken.
 *
 * Point `DATABASE_URL` at Neon's POOLED endpoint (the host containing
 * `-pooler`). PgBouncer runs in transaction mode there, which is compatible
 * with `SET LOCAL` — the transaction is the pooling unit — and node-postgres
 * does not use named prepared statements by default, so the other usual
 * PgBouncer hazard does not apply either.
 *
 * If you later need the edge runtime, swap this module for
 * `drizzle-orm/neon-serverless` + `Pool`; nothing above lib/db/ knows.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { serverEnv } from '@/lib/env';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

/**
 * Serverless invocations are short and concurrent. A large pool per instance
 * multiplies into Neon's connection limit for no benefit, so keep it small and
 * let the pooled endpoint do the real multiplexing.
 */
const POOL_MAX = Number(process.env.DB_POOL_MAX ?? 5);
const POOL_IDLE_TIMEOUT_MS = 10_000;
const POOL_CONNECT_TIMEOUT_MS = 10_000;

type Holder = { pool: Pool; db: Database };

// Next.js dev reloads modules on every edit. Without this the pools leak a new
// set of connections per reload until Neon starts refusing them.
const globalForDb = globalThis as unknown as {
  __dojoOwnerDb?: Holder;
  __dojoAppDb?: Holder;
};

function create(connectionString: string, label: string): Holder {
  const pool = new Pool({
    connectionString,
    max: POOL_MAX,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS,
  });

  // An idle client erroring out must not take the process with it.
  pool.on('error', (err) => {
    console.error(`[db:${label}] idle client error`, err);
  });

  return { pool, db: drizzle(pool, { schema }) };
}

/**
 * The privileged handle. Connects as the database owner, which on Neon holds
 * BYPASSRLS — row-level security does NOT constrain it.
 *
 * Use it only for Auth.js adapter traffic, migrations, and seeding. Everything
 * that touches player-owned rows goes through `withPlayer()` in lib/db/rls.ts.
 */
export function ownerDb(): Database {
  if (!globalForDb.__dojoOwnerDb) {
    globalForDb.__dojoOwnerDb = create(serverEnv().DATABASE_URL, 'owner');
  }
  return globalForDb.__dojoOwnerDb.db;
}

/**
 * The handle request-scoped work runs on, wrapped by `withPlayer()`.
 *
 * Prefers APP_DATABASE_URL — the `app_user` login role from
 * `npm run db:app-role` — and falls back to the owner connection when it is not
 * configured. Both enforce every policy; they differ in whether the demotion
 * can be undone. See the APP_DATABASE_URL note in lib/env.ts.
 */
export function appDb(): Database {
  if (!globalForDb.__dojoAppDb) {
    const env = serverEnv();
    const url = env.APP_DATABASE_URL?.trim();
    globalForDb.__dojoAppDb = url
      ? create(url, 'app')
      : { ...create(env.DATABASE_URL, 'app-via-owner') };
  }
  return globalForDb.__dojoAppDb.db;
}

/** True when request traffic connects as a dedicated role rather than the owner. */
export function isHardenedConnection(): boolean {
  return Boolean(serverEnv().APP_DATABASE_URL?.trim());
}

export async function closeDb(): Promise<void> {
  const holders = [globalForDb.__dojoOwnerDb, globalForDb.__dojoAppDb].filter(Boolean) as Holder[];
  globalForDb.__dojoOwnerDb = undefined;
  globalForDb.__dojoAppDb = undefined;
  await Promise.all(holders.map((h) => h.pool.end()));
}
