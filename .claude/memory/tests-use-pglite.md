---
name: tests-use-pglite
description: The integration suite runs on in-process PGlite by default and against real Neon when TEST_DATABASE_URL is set.
metadata:
  type: project
---

`tests/integration/harness.ts` picks its backend at runtime. With
`TEST_DATABASE_URL` set it uses node-postgres against that database; without it,
PGlite — genuine Postgres 18 compiled to WASM, in-process, about a second to
stand up. Both run the same migration files.

Verified empirically before adopting it: PGlite supports `CREATE ROLE`, `GRANT`,
`FORCE ROW LEVEL SECURITY`, `SET LOCAL ROLE` and `current_setting()`, and
enforces policies correctly.

**Why:** a row-level security policy that CI never executes is a policy nobody
knows is broken. Requiring a live credential would have meant the RLS test ran
rarely; requiring Docker would have meant it ran on some machines and not
others.

**How to apply:** PGlite's default user is a **superuser**, and superusers bypass
RLS unconditionally. Never assert what the owner connection can see — such a
test passes or fails for reasons unrelated to the policies. Assert against
`app_user` only. And because that superuser hides whole classes of grant bug
(see [[postgres-set-role-option]]), run against real Neon before shipping any
database change.
