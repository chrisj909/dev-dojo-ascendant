/**
 * Shared connection helper for the CLI scripts (migrate, seed, verify-rls).
 *
 * Kept apart from lib/db/client.ts because these run outside Next.js: they load
 * .env.local themselves and connect to the DIRECT endpoint, since Neon's pooled
 * host is PgBouncer in transaction mode and is not a reliable place for DDL.
 */

import { config } from 'dotenv';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '@/lib/db/schema';

config({ path: ['.env.local', '.env'], quiet: true });

export type ScriptDb = NodePgDatabase<typeof schema>;

export function connectionString(kind: 'direct' | 'pooled' = 'direct'): string {
  const direct = process.env.DATABASE_URL_UNPOOLED?.trim();
  const pooled = process.env.DATABASE_URL?.trim();
  const url = kind === 'direct' ? direct || pooled : pooled || direct;

  if (!url) {
    throw new Error(
      'No connection string. Set DATABASE_URL (and ideally DATABASE_URL_UNPOOLED) in .env.local — see .env.example.',
    );
  }
  if (kind === 'direct' && !direct && pooled?.includes('-pooler')) {
    console.warn(
      '[db] DATABASE_URL_UNPOOLED is not set, so DDL will run through the pooled endpoint.\n' +
        '     Take DATABASE_URL and delete "-pooler" from the host to get the direct one.',
    );
  }
  return url;
}

export function openPool(kind: 'direct' | 'pooled' = 'direct'): Pool {
  return new Pool({ connectionString: connectionString(kind), max: 2 });
}

export function open(kind: 'direct' | 'pooled' = 'direct'): { pool: Pool; db: ScriptDb } {
  const pool = openPool(kind);
  return { pool, db: drizzle(pool, { schema }) };
}

/** Host of the configured database, for log lines that must not leak the password. */
export function describeTarget(kind: 'direct' | 'pooled' = 'direct'): string {
  try {
    const parsed = new URL(connectionString(kind));
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}
