/**
 * Integration test harness.
 *
 * Runs the real migrations — including drizzle/0001_rls.sql, the row-level
 * security policies that ship — against a real Postgres, then hands back a
 * drizzle handle plus the fixtures the suite needs.
 *
 * TWO BACKENDS, ONE SET OF SQL
 *
 *   TEST_DATABASE_URL set    node-postgres against that database. Point it at a
 *                            throwaway Neon branch to confirm YOUR Neon project
 *                            is configured correctly. This is the high-fidelity
 *                            path and the one to trust before shipping.
 *
 *   TEST_DATABASE_URL unset  PGlite: genuine Postgres 18 compiled to WASM,
 *                            in-process, about a second to stand up. Same
 *                            migration files, same policies, no credentials and
 *                            no containers. This is what CI runs, so a broken
 *                            policy fails a pull request instead of waiting to
 *                            be noticed in production.
 *
 * PGlite's superuser bypasses RLS the way any superuser does, which is exactly
 * why the suite asserts against `app_user` and never against the owner: an
 * assertion about what the owner can see would pass or fail for reasons that
 * have nothing to do with the policies.
 */

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { sql } from 'drizzle-orm';

import * as schema from '@/lib/db/schema';
import type { AnyDatabase } from '@/lib/db/rls';
import { assertSafeTestTarget } from '@/tests/support/database-target';

const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');

export type HarnessKind = 'pglite' | 'postgres';

export type Harness = {
  kind: HarnessKind;
  db: AnyDatabase;
  /** Empty every game table, leaving schema and policies in place. */
  reset(): Promise<void>;
  close(): Promise<void>;
};

/** Tables truncated between tests, ordered so cascades do the rest. */
const TRUNCATABLE = [
  'drill_log',
  'challenges',
  'facilities',
  'techniques',
  'scrolls',
  'branches',
  'students',
  'dojos',
  'players',
  'regions',
  'accounts',
  'sessions',
  'verification_tokens',
  'users',
] as const;

function assertMigrationsExist(): void {
  const files = readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql'));
  if (files.length === 0) {
    throw new Error(
      `No migrations found in ${MIGRATIONS_FOLDER}. Run \`npm run db:generate\` first.`,
    );
  }
}

async function createPglite(): Promise<Harness> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');

  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    kind: 'pglite',
    db: db as unknown as AnyDatabase,
    reset: () => truncateAll(db as unknown as AnyDatabase),
    close: async () => {
      await client.close();
    },
  };
}

async function createPostgres(url: string): Promise<Harness> {
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');

  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    kind: 'postgres',
    db: db as unknown as AnyDatabase,
    reset: () => truncateAll(db as unknown as AnyDatabase),
    close: async () => {
      await pool.end();
    },
  };
}

/**
 * TRUNCATE is a table-level operation and is not filtered by RLS, so this works
 * as the owner even with FORCE ROW LEVEL SECURITY in effect.
 */
async function truncateAll(db: AnyDatabase): Promise<void> {
  const list = TRUNCATABLE.map((t) => `public."${t}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

export async function createHarness(): Promise<Harness> {
  assertMigrationsExist();
  const url = process.env.TEST_DATABASE_URL?.trim();

  if (url) {
    // This suite truncates every table between tests. Before touching a real
    // server, prove the target is not the database the application is serving
    // from — the two are distinguished by nothing but an environment variable,
    // and getting it wrong once emptied live region and user data.
    assertSafeTestTarget(url, [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED]);

    if (/\bneon\.tech\b/.test(url) && !/[?&]sslmode=/.test(url)) {
      throw new Error('TEST_DATABASE_URL points at Neon but omits sslmode=require');
    }
    return createPostgres(url);
  }
  return createPglite();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export type Tenant = {
  userId: string;
  playerId: string;
  dojoId: string;
  studentId: string;
  branchId: string;
  handle: string;
};

/** Deterministic uuids so failures name the tenant that broke. */
export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';
/** A user with no player row at all — the "signed in but not onboarded" case. */
export const USER_C = '33333333-3333-4333-8333-333333333333';

export function studentDefaults(dojoId: string, name: string) {
  return {
    dojoId,
    name,
    strength: 10,
    speed: 10,
    technique: 10,
    stamina: 10,
    mental: 10,
    aptStriking: 5,
    aptGrappling: 5,
    aptInternal: 5,
    aptWeapons: 5,
    temperament: 'steady',
  };
}
