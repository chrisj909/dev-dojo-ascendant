-- Row-level security. SPEC §3 "RLS", SPEC §7 test 12.
--
-- Plain Postgres. This runs on Neon exactly as written; nothing here depends on
-- a vendor extension, a JWT integration, or any particular hosting provider.
--
-- Hand-written rather than generated because drizzle-kit models neither role
-- creation nor FORCE ROW LEVEL SECURITY, and both are load-bearing:
--
--   * A table's OWNER bypasses its own RLS policies. Since the application
--     connects as the owner, enabling RLS without FORCE would be decorative.
--   * FORCE still does not constrain a role holding the BYPASSRLS attribute
--     (or a superuser). So request-scoped code additionally demotes itself to
--     `app_user`, which owns nothing and holds no such attribute.
--
-- Neither control is sufficient alone. See lib/db/rls.ts.

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint

-- The caller's auth user id, injected per transaction by lib/db/rls.ts.
-- Unset or empty yields NULL, and every comparison against NULL is NULL, which
-- the policies treat as false. The failure mode is denial, never disclosure.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- Runs as the caller, so the players policy below is what restricts it to a
-- single row. Deliberately NOT security definer: it must not see more than the
-- caller can.
CREATE OR REPLACE FUNCTION app.current_player_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT id FROM public.players WHERE user_id = app.current_user_id() $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.current_dojo_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT id FROM public.dojos WHERE player_id = app.current_player_id() $$;
--> statement-breakpoint

-- Introspection used by `npm run verify:rls` and the integration suite, so that
-- "is every table actually protected" is a query rather than an assumption.
CREATE OR REPLACE FUNCTION app.rls_status()
  RETURNS TABLE (table_name text, rls_enabled boolean, rls_forced boolean, policy_count bigint)
  LANGUAGE sql STABLE
  AS $$
    SELECT c.relname::text,
           c.relrowsecurity,
           c.relforcerowsecurity,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The request-scoped role
-- ---------------------------------------------------------------------------

-- NOLOGIN: nothing ever connects as app_user directly. The application reaches
-- it via SET LOCAL ROLE inside a transaction, which means there is no second
-- connection string to distribute, rotate, or leak.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

-- The connecting role must be able to SET ROLE to app_user, and on Postgres 16+
-- that is NOT implied by membership.
--
-- Creating a role auto-grants it back to the creator, but with
-- `set_option = false` unless `createrole_self_grant` says otherwise. Neon
-- leaves that at its default, so on a real Neon database `neondb_owner` ends up
-- holding ADMIN OPTION over `app_user` while being unable to become it, and
-- every request fails with `permission denied to set role "app_user"`.
--
-- `pg_has_role(..., 'MEMBER')` returns true in that state and is therefore the
-- wrong thing to test; 'SET' is the mode that answers the question actually
-- being asked. This was caught by running against Neon rather than only against
-- the in-process Postgres used by the tests, whose superuser never needs the
-- grant at all.
DO $$
DECLARE
  can_set boolean;
BEGIN
  BEGIN
    SELECT pg_has_role(current_user, 'app_user', 'SET') INTO can_set;
  EXCEPTION WHEN OTHERS THEN
    -- The 'SET' mode postdates Postgres 16; on older servers membership is the
    -- same thing.
    SELECT pg_has_role(current_user, 'app_user', 'MEMBER') INTO can_set;
  END;

  IF can_set THEN
    RETURN;
  END IF;

  BEGIN
    EXECUTE format('GRANT app_user TO %I WITH SET TRUE', current_user);
  EXCEPTION WHEN syntax_error THEN
    EXECUTE format('GRANT app_user TO %I', current_user);
  END;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Granted table by table rather than with ON ALL TABLES. The auth tables must
-- never be reachable from a request-scoped statement, and an explicit list
-- cannot silently acquire a new member the way a wildcard can.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO app_user;--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO app_user;--> statement-breakpoint

GRANT SELECT ON public.regions TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.players TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dojos TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scrolls TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.techniques TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facilities TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drill_log TO app_user;--> statement-breakpoint
-- Challenge history is append-only: resolved matches are evidence, not state.
GRANT SELECT, INSERT ON public.challenges TO app_user;--> statement-breakpoint

-- Auth tables are the adapter's alone. Revoke rather than merely omit, in case
-- a default privilege or a PUBLIC grant ever hands them over.
REVOKE ALL ON public.users FROM app_user;--> statement-breakpoint
REVOKE ALL ON public.accounts FROM app_user;--> statement-breakpoint
REVOKE ALL ON public.sessions FROM app_user;--> statement-breakpoint
REVOKE ALL ON public.verification_tokens FROM app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Regions: world-readable reference data. RLS is enabled so app_user is held to
-- the read-only policy, but deliberately NOT forced — seeding and migrations
-- run as the owner and must be able to write.
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS regions_world_read ON public.regions;--> statement-breakpoint
CREATE POLICY regions_world_read ON public.regions FOR SELECT USING (true);--> statement-breakpoint

-- Players: a player row is visible only to the auth user it belongs to.
-- WITH CHECK is what stops a caller inserting or re-pointing a row at someone
-- else's user_id; USING alone would leave that open.
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.players FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS players_self ON public.players;--> statement-breakpoint
CREATE POLICY players_self ON public.players FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint

ALTER TABLE public.dojos ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.dojos FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS dojos_own ON public.dojos;--> statement-breakpoint
CREATE POLICY dojos_own ON public.dojos FOR ALL
  USING (player_id = app.current_player_id())
  WITH CHECK (player_id = app.current_player_id());
--> statement-breakpoint

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.students FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS students_own ON public.students;--> statement-breakpoint
CREATE POLICY students_own ON public.students FOR ALL
  USING (dojo_id = app.current_dojo_id())
  WITH CHECK (dojo_id = app.current_dojo_id());
--> statement-breakpoint

ALTER TABLE public.scrolls ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.scrolls FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS scrolls_own ON public.scrolls;--> statement-breakpoint
CREATE POLICY scrolls_own ON public.scrolls FOR ALL
  USING (dojo_id = app.current_dojo_id())
  WITH CHECK (dojo_id = app.current_dojo_id());
--> statement-breakpoint

ALTER TABLE public.techniques ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.techniques FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS techniques_own ON public.techniques;--> statement-breakpoint
CREATE POLICY techniques_own ON public.techniques FOR ALL
  USING (dojo_id = app.current_dojo_id())
  WITH CHECK (dojo_id = app.current_dojo_id());
--> statement-breakpoint

ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.facilities FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS facilities_own ON public.facilities;--> statement-breakpoint
CREATE POLICY facilities_own ON public.facilities FOR ALL
  USING (dojo_id = app.current_dojo_id())
  WITH CHECK (dojo_id = app.current_dojo_id());
--> statement-breakpoint

ALTER TABLE public.drill_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.drill_log FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS drill_log_own ON public.drill_log;--> statement-breakpoint
CREATE POLICY drill_log_own ON public.drill_log FOR ALL
  USING (dojo_id = app.current_dojo_id())
  WITH CHECK (dojo_id = app.current_dojo_id());
--> statement-breakpoint

-- Branches: world-readable, because a lineage holds visible territory in a
-- region (GDD §9.2) and rivals must be able to see it. Writes stay with the
-- root dojo. The read policy is scoped FOR SELECT precisely so it does not
-- widen the write paths — permissive policies OR together within a command, so
-- a FOR ALL read policy here would have unlocked writes for everyone.
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.branches FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS branches_world_read ON public.branches;--> statement-breakpoint
DROP POLICY IF EXISTS branches_own_insert ON public.branches;--> statement-breakpoint
DROP POLICY IF EXISTS branches_own_update ON public.branches;--> statement-breakpoint
DROP POLICY IF EXISTS branches_own_delete ON public.branches;--> statement-breakpoint
CREATE POLICY branches_world_read ON public.branches FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY branches_own_insert ON public.branches FOR INSERT
  WITH CHECK (root_dojo_id = app.current_dojo_id());
--> statement-breakpoint
CREATE POLICY branches_own_update ON public.branches FOR UPDATE
  USING (root_dojo_id = app.current_dojo_id())
  WITH CHECK (root_dojo_id = app.current_dojo_id());
--> statement-breakpoint
CREATE POLICY branches_own_delete ON public.branches FOR DELETE
  USING (root_dojo_id = app.current_dojo_id());
--> statement-breakpoint

-- Challenges: readable by both participants (SPEC §3), insertable only by the
-- attacker, and never updatable or deletable by anyone. A resolved match is a
-- historical record; SPEC §2.4 has reports regenerate from the stored snapshot,
-- which only holds if the snapshot cannot be edited afterwards.
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.challenges FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS challenges_participant_read ON public.challenges;--> statement-breakpoint
DROP POLICY IF EXISTS challenges_attacker_insert ON public.challenges;--> statement-breakpoint
CREATE POLICY challenges_participant_read ON public.challenges FOR SELECT
  USING (
    attacker_dojo_id = app.current_dojo_id()
    OR defender_dojo_id = app.current_dojo_id()
  );
--> statement-breakpoint
CREATE POLICY challenges_attacker_insert ON public.challenges FOR INSERT
  WITH CHECK (attacker_dojo_id = app.current_dojo_id());
