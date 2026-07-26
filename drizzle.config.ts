import { defineConfig } from 'drizzle-kit';

import 'dotenv/config';

/**
 * DDL runs on the direct (non-pooled) endpoint. Neon's pooled host runs
 * PgBouncer in transaction mode, which is fine for request traffic but an
 * unreliable place to run schema changes and `CREATE ROLE`.
 */
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error('DATABASE_URL (or DATABASE_URL_UNPOOLED) must be set to run drizzle-kit');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
  // `app_user` and the RLS policies are created by the hand-written
  // 0001_rls.sql migration, not modelled in schema.ts. Without this,
  // drizzle-kit sees roles it does not know about and offers to drop them.
  entities: { roles: false },
});
