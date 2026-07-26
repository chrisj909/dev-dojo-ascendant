/**
 * Applies pending migrations, including the hand-written RLS migration.
 *
 * Run against the DIRECT Neon endpoint. Deliberately NOT wired into the Vercel
 * build command: a build can be skipped, auto-cancelled, or rolled back
 * independently of the schema, and any of those leaves code and database
 * disagreeing while the deploy still reports success. CI runs this on merge to
 * main instead — see .github/workflows/migrate.yml.
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { describeTarget, open } from './db';

async function main() {
  const { pool, db } = open('direct');
  console.log(`[migrate] target ${describeTarget('direct')}`);

  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
    console.log('[migrate] up to date');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[migrate] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
