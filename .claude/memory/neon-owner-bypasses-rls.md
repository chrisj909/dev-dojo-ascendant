---
name: neon-owner-bypasses-rls
description: Neon's neondb_owner holds BYPASSRLS, so FORCE ROW LEVEL SECURITY alone provides no isolation.
metadata:
  type: project
---

Neon's default database role (`neondb_owner`) has the **BYPASSRLS** attribute.
Confirmed against this project's own database — `npm run verify:rls` prints it
as a note on every run.

A role with BYPASSRLS ignores row-level security entirely, including
`FORCE ROW LEVEL SECURITY`. FORCE removes only the _owner's_ implicit exemption;
it does nothing about the BYPASSRLS attribute itself.

**Why:** the application connects as `neondb_owner`. Had RLS merely been enabled
and forced, every policy in the database would have been decorative and every
query would have seen every tenant's rows — while appearing to work perfectly.

**How to apply:** never treat "RLS is enabled and forced" as evidence of
isolation on Neon. The actual control is that `withPlayer()` in `lib/db/rls.ts`
issues `SET LOCAL ROLE app_user` before every request-scoped statement, and
`app_user` holds neither superuser nor BYPASSRLS. Run `npm run verify:rls` after
any migration — it asserts those attributes rather than assuming them. See also
[[postgres-set-role-option]].
