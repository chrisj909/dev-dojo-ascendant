---
name: postgres-set-role-option
description: Postgres 16 split role membership from the right to SET ROLE, so pg_has_role(...,'MEMBER') is the wrong check.
metadata:
  type: project
---

On Postgres 16+, `CREATE ROLE` auto-grants the new role back to its creator with
`set_option = false` unless `createrole_self_grant` says otherwise. Neon leaves
that at its default.

The result is a state where `neondb_owner` holds ADMIN OPTION over `app_user`
and **cannot become it**. `pg_has_role(current_user, 'app_user', 'MEMBER')`
returns **true** throughout, while every request fails at runtime with
`permission denied to set role "app_user"`.

**Why:** this cost a debugging cycle during the Phase 1 build. The migration's
guard used `'MEMBER'`, reported success, and the failure appeared only against
real Neon — PGlite's superuser never needs the grant, so the entire test suite
was green.

**How to apply:** test `pg_has_role(..., 'SET')`, never `'MEMBER'`. The fix is
`GRANT app_user TO <role> WITH SET TRUE`, applied idempotently in
`drizzle/0002_rls_set_role.sql`. More generally: this class of bug is invisible
to [[tests-use-pglite]], so run the integration suite against real Neon with
`TEST_DATABASE_URL` set before trusting any database change.
