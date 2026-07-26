/**
 * Provisions `app_user` as a LOGIN role and prints the connection string to set
 * as APP_DATABASE_URL.
 *
 *   npm run db:app-role
 *
 * WHY BOTHER
 *
 * Without APP_DATABASE_URL the application connects as the owner and demotes
 * itself per transaction with SET LOCAL ROLE. Every policy is enforced, but the
 * demotion is reversible: Postgres authorises SET ROLE against the session user,
 * so code that can run arbitrary SQL could return to the owner. Connecting as
 * `app_user` in the first place removes the thing to return to.
 *
 * The password is generated here and printed once. It is never written to a
 * file and never committed — paste it into .env.local and into Vercel.
 */

import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { connectionString, describeTarget, open } from './db';

function generatePassword(): string {
  // base64url, no padding: safe inside a URL without escaping.
  return randomBytes(24).toString('base64url');
}

function buildUrl(base: string, password: string): string {
  const url = new URL(base);
  url.username = 'app_user';
  url.password = password;
  return url.toString();
}

async function main() {
  const { pool, db } = open('direct');
  const password = generatePassword();

  console.log(`\ndb:app-role — ${describeTarget('direct')}\n`);

  try {
    const exists = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_roles where rolname = 'app_user'`,
    );
    const found = Number((exists as unknown as { rows: { n: number }[] }).rows[0].n) > 0;

    if (!found) {
      throw new Error('app_user does not exist. Run `npm run db:migrate` first.');
    }

    // ALTER rather than CREATE: migration 0001 already created the role and
    // granted it exactly the privileges it should have. This only adds LOGIN.
    await db.execute(
      sql.raw(`ALTER ROLE app_user WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}'`),
    );

    // A login role still must not be able to bypass what it is being confined by.
    const check = (await db.execute(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = 'app_user'`,
    )) as unknown as { rows: { rolsuper: boolean; rolbypassrls: boolean }[] };
    const row = check.rows[0];
    if (row.rolsuper || row.rolbypassrls) {
      throw new Error(
        'app_user holds superuser or BYPASSRLS — refusing to hand out a login for it',
      );
    }

    const pooled = buildUrl(connectionString('pooled'), password);

    console.log('app_user can now log in. Add this to .env.local and to Vercel:\n');
    console.log(`APP_DATABASE_URL="${pooled}"\n`);
    console.log('Shown once — it is not stored anywhere. Re-run this script to rotate it.');
    console.log('DATABASE_URL stays as the owner string: migrations and Auth.js still need it.\n');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[db:app-role] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
