---
name: driver-choice-node-postgres
description: Uses node-postgres against Neon rather than @neondatabase/serverless, because the RLS design needs real transactions.
metadata:
  type: project
---

The project connects to Neon with `pg` (node-postgres), not Neon's own
`@neondatabase/serverless` driver.

**Why:** the RLS design requires `SET LOCAL ROLE` and
`set_config('app.user_id', ...)` to be visible to the statements that follow,
inside one transaction. Neon's HTTP mode issues each statement as an independent
request and cannot hold session state, which rules it out. What remains is
Neon's WebSocket pool, which is API-compatible with node-postgres and buys
little over it — while `pg` also talks to a plain Postgres, which is what lets
the RLS suite run in CI with no credentials.

Neon's pooled endpoint (PgBouncer, transaction mode) is compatible with
`SET LOCAL` because the transaction is the pooling unit, and node-postgres does
not use named prepared statements by default, so the other usual PgBouncer
hazard does not apply either.

**How to apply:** if the edge runtime is ever needed, swap `lib/db/client.ts` for
`drizzle-orm/neon-serverless` + `Pool` — nothing above `lib/db/` depends on the
driver. Do not reach for the HTTP driver for request traffic: it would silently
break tenant isolation, not merely perform differently.
