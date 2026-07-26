/**
 * Answers one question about a live database: is row-level security actually in
 * force right now?
 *
 * Structural checks only — it writes nothing and can be run against production
 * safely. Use it after a migration, after adding a table, and whenever someone
 * asks "are we sure tenants are isolated". The integration suite proves the
 * policies deny the right things; this proves they are switched on *here*.
 *
 *   npm run verify:rls
 */

import { sql } from 'drizzle-orm';

import { AUTH_TABLES } from '@/lib/db/schema';
import { describeTarget, open } from './db';

/** Tables that must be ENABLE + FORCE and carry at least one policy. */
const OWNED_TABLES = [
  'players',
  'dojos',
  'students',
  'branches',
  'scrolls',
  'techniques',
  'facilities',
  'challenges',
  'drill_log',
] as const;

type Row = Record<string, unknown>;

const problems: string[] = [];
const notes: string[] = [];

function fail(message: string) {
  problems.push(message);
  console.log(`  FAIL  ${message}`);
}
function pass(message: string) {
  console.log(`  ok    ${message}`);
}
function note(message: string) {
  notes.push(message);
  console.log(`  note  ${message}`);
}

async function main() {
  const { pool, db } = open('direct');

  const q = async (query: ReturnType<typeof sql>): Promise<Row[]> => {
    const result = await db.execute(query);
    return (result as unknown as { rows: Row[] }).rows;
  };

  console.log(`\nverify:rls — ${describeTarget('direct')}\n`);

  try {
    // -- 1. Who are we, and can we be trusted to be constrained? ------------
    console.log('connecting role');
    const [role] = await q(sql`
      select current_user as name, rolsuper, rolbypassrls
      from pg_roles where rolname = current_user
    `);
    console.log(`  role  ${role.name}`);

    if (role.rolsuper) {
      note(
        `${role.name} is a SUPERUSER and bypasses RLS unconditionally. ` +
          'Policies still protect app_user, which is what request traffic runs as.',
      );
    }
    if (role.rolbypassrls) {
      note(
        `${role.name} holds BYPASSRLS. This is expected on Neon and is exactly why ` +
          'lib/db/rls.ts demotes to app_user rather than relying on FORCE alone.',
      );
    }

    // -- 2. Does the request-scoped role exist and is it safe? --------------
    console.log('\napp_user role');
    const [appUser] = await q(sql`
      select rolname, rolsuper, rolbypassrls, rolcanlogin
      from pg_roles where rolname = 'app_user'
    `);
    if (!appUser) {
      fail('app_user does not exist — run `npm run db:migrate`');
    } else {
      pass('exists');
      if (appUser.rolsuper) fail('app_user is a superuser and would bypass every policy');
      else pass('not a superuser');
      if (appUser.rolbypassrls) fail('app_user holds BYPASSRLS and would bypass every policy');
      else pass('does not hold BYPASSRLS');
      if (appUser.rolcanlogin)
        note('app_user can log in; nothing should be connecting as it directly');
      else pass('cannot log in directly');
    }

    // -- 3. Can the connecting role actually assume it? ---------------------
    // 'SET', not 'MEMBER'. Postgres 16 split the two, and Neon's auto-grant
    // leaves the owner a member that cannot SET ROLE — 'MEMBER' reports true
    // while every request fails. See drizzle/0002_rls_set_role.sql.
    const [member] = await q(sql`
      select pg_has_role(current_user, 'app_user', 'SET') as can_set,
             pg_has_role(current_user, 'app_user', 'MEMBER') as is_member
    `);
    if (member?.can_set) {
      pass('connecting role can SET ROLE app_user');
    } else if (member?.is_member) {
      fail(
        'connecting role is a member of app_user but lacks SET — every request will fail with ' +
          '"permission denied to set role". Run `npm run db:migrate`.',
      );
    } else {
      fail('connecting role is not a member of app_user — withPlayer() will fail at runtime');
    }

    // -- 4. Is every owned table switched on? -------------------------------
    console.log('\ntable protection');
    const status = new Map(
      (await q(sql`select * from app.rls_status()`)).map((r) => [r.table_name as string, r]),
    );

    for (const table of OWNED_TABLES) {
      const row = status.get(table);
      if (!row) {
        fail(`${table}: table not found`);
        continue;
      }
      const enabled = row.rls_enabled === true;
      const forced = row.rls_forced === true;
      const policies = Number(row.policy_count);

      if (enabled && forced && policies > 0) {
        pass(`${table}: enabled, forced, ${policies} ${policies === 1 ? 'policy' : 'policies'}`);
      } else {
        if (!enabled) fail(`${table}: RLS is DISABLED`);
        else if (!forced) fail(`${table}: RLS is not FORCED — the owner bypasses it`);
        if (policies === 0)
          fail(`${table}: RLS is on but no policy exists, so all access is denied`);
      }
    }

    const regions = status.get('regions');
    if (regions?.rls_enabled) pass('regions: enabled (world-readable, FORCE intentionally off)');
    else fail('regions: RLS is disabled');

    // -- 5. Any public table we forgot entirely? ----------------------------
    console.log('\ncoverage');
    const known = new Set<string>([...OWNED_TABLES, 'regions', ...AUTH_TABLES]);
    const unknown = [...status.keys()].filter((t) => !known.has(t) && !t.startsWith('__drizzle'));
    if (unknown.length === 0) pass('no unclassified tables in public');
    else
      fail(
        `unclassified table(s) in public: ${unknown.join(', ')} — ` +
          'add a policy and list them here, or they are wide open to app_user',
      );

    // -- 6. Are the auth tables out of reach? -------------------------------
    console.log('\nauth table isolation');
    for (const table of AUTH_TABLES) {
      const [granted] = await q(sql`
        select count(*)::int as n
        from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = ${table}
          and grantee = 'app_user'
      `);
      if (Number(granted.n) === 0) pass(`${table}: no privileges granted to app_user`);
      else fail(`${table}: app_user holds ${granted.n} privilege(s) and can read auth data`);
    }

    // -- 7. Do the identity helpers exist? ----------------------------------
    console.log('\nidentity helpers');
    for (const fn of ['current_user_id', 'current_player_id', 'current_dojo_id']) {
      const [exists] = await q(sql`
        select count(*)::int as n from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = ${fn}
      `);
      if (Number(exists.n) > 0) pass(`app.${fn}() defined`);
      else fail(`app.${fn}() is missing`);
    }

    // -- 8. Live proof: does demoting actually change what is visible? ------
    // Read-only, inside a transaction, rolled back regardless.
    console.log('\nlive context switch');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id', $1, true)`, [
        '00000000-0000-4000-8000-000000000000',
      ]);
      await client.query(`select set_config('role', 'app_user', true)`);
      const who = await client.query('select current_user as name');
      if (who.rows[0].name === 'app_user') pass('SET LOCAL ROLE app_user takes effect');
      else fail(`expected current_user app_user, got ${who.rows[0].name}`);

      const seen = await client.query('select count(*)::int as n from public.players');
      if (Number(seen.rows[0].n) === 0) {
        pass('an unknown identity sees 0 player rows');
      } else {
        fail(
          `an unknown identity sees ${seen.rows[0].n} player row(s) — policies are not filtering`,
        );
      }

      let deniedUsers = false;
      try {
        await client.query('select count(*) from public.users');
      } catch {
        deniedUsers = true;
      }
      if (deniedUsers) pass('app_user is denied access to public.users');
      else fail('app_user can read public.users');
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
    }

    // -- Verdict ------------------------------------------------------------
    console.log('');
    if (problems.length === 0) {
      console.log(
        `PASS — row-level security is in force${notes.length ? ` (${notes.length} note(s))` : ''}\n`,
      );
    } else {
      console.log(`FAIL — ${problems.length} problem(s):`);
      for (const p of problems) console.log(`  - ${p}`);
      console.log('');
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[verify:rls] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
