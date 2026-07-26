-- Grants the connecting role the right to SET ROLE app_user.
--
-- 0001 has been corrected to do this itself, so on a fresh database this
-- migration is a no-op. It exists for databases that already applied the
-- original 0001 — drizzle tracks applied migrations by timestamp, not by
-- content hash, so editing 0001 does not re-run it on a database that has
-- already seen it.
--
-- Background: on Postgres 16+, creating a role auto-grants it back to the
-- creator with `set_option = false`. The holder can administer the role but
-- cannot become it, and `pg_has_role(..., 'MEMBER')` reports true throughout.
-- Every request then fails with `permission denied to set role "app_user"`.

DO $$
DECLARE
  can_set boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    RAISE EXCEPTION 'app_user does not exist; migration 0001 has not been applied';
  END IF;

  BEGIN
    SELECT pg_has_role(current_user, 'app_user', 'SET') INTO can_set;
  EXCEPTION WHEN OTHERS THEN
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
