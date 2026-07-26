# Decisions

Why things are the way they are, especially where they differ from
`IMPLEMENTATION_SPEC.md`. The spec is the contract; this file records where it
was deliberately departed from and what was traded.

`spec-guardian` checks this file before reporting a deviation, so a decision
recorded here stops being a finding.

---

## D1 — Neon instead of Supabase

**Spec says:** Supabase (Postgres + RLS), because "row-level security maps
cleanly to _players only mutate their own dojo_" (SPEC §1).

**We use:** Neon Postgres, with Auth.js for authentication.

**Why:** project direction. Vercel deploys from GitHub, Neon is the database.

**What it changes:**

- There is no `auth.users` schema, so `players.user_id` references a local
  `users` table written by the Auth.js Drizzle adapter.
- There is no `auth.uid()`. Identity is injected per transaction as
  `app.user_id` and read by `app.current_user_id()`.
- There is no PostgREST, so no directly-exposed table API. This changes what
  SPEC §7 test 12 can mean — see D2.

**What it does not change:** row-level security is real Postgres RLS and works
identically. Neon is plain Postgres 18.4.

---

## D2 — Test 12 tests the database, not the HTTP layer

**Spec says:** "RLS blocks a player from mutating another player's dojo,
students, or branches **via direct API call**" (SPEC §7 test 12).

**We test:** the same denials at the database layer, through the real
`withPlayer()` wrapper the application uses.

**Why:** "direct API call" assumed PostgREST, where the tables are the API. On
Neon there is no such surface — every query goes through this application.
Testing the HTTP layer would only prove our own route handlers check ownership,
which is one forgotten `if` away from being false, and is not the property the
spec was pinning down.

Pushing the test one layer lower makes it stronger: it proves that when somebody
_does_ forget an ownership check, the database refuses anyway.

---

## D3 — node-postgres, not Neon's serverless driver

**Why:** the RLS design needs `SET LOCAL ROLE` and `set_config()` to be visible
to the statements that follow, in one transaction. Neon's HTTP mode issues each
statement independently and cannot hold session state. Neon's WebSocket pool
can, but is API-compatible with node-postgres and buys little over it — while
`pg` also talks to a plain Postgres, which is what lets the RLS suite run in CI
with no credentials.

**Traded away:** the edge runtime. Swap `lib/db/client.ts` for
`drizzle-orm/neon-serverless` if that is ever needed; nothing above `lib/db/`
knows which driver is in use.

---

## D4 — The app connects as the owner and demotes per transaction

**Why:** the alternative — a dedicated `app_user` login role — needs a second
credential provisioned, distributed and rotated before anything works at all.
Demoting with `SET LOCAL ROLE` needs no second connection string, and enforces
every policy identically.

**What it does not cover:** Postgres authorises `SET ROLE` against the _session_
user, so code inside `withPlayer()` can name the owner role and climb back out.
Reaching that requires executing arbitrary SQL, which given drizzle's
parameterisation means a SQL injection bug. The design defends against the
realistic failure — a server action that forgets an ownership check — and not
the exotic one.

`tests/integration/rls.test.ts` asserts this limitation rather than pretending
otherwise, and flips to asserting denial automatically once hardened.

**To close it:** `npm run db:app-role`, then set `APP_DATABASE_URL`. Tracked as
`app-database-url-in-production` in `BACKLOG.md`, and it should be done before
any public deploy.

---

## D5 — Schema deviations

| Change                                | Why                                                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dojos.player_id` is UNIQUE           | MVP is one dojo per player. A database constraint removes a whole class of duplicate-creation bug.                                                                                     |
| `branches.root_dojo_id` added         | Ownership of a 4th-generation branch is otherwise a recursive walk up `parent_branch_id`, which an RLS policy cannot express without a recursive CTE on every row read.                |
| `regions.slug` added                  | Seeding is idempotent by natural key.                                                                                                                                                  |
| `drill_log.dojo_id` added             | So the log's RLS policy does not have to join through `students` on every row.                                                                                                         |
| All SPEC §3 tables created in Phase 1 | Test 12 requires policies on `students` and `branches` to be demonstrably in force, and a policy cannot be tested against a table that does not exist. No game logic touches them yet. |

---

## D6 — JWT sessions rather than database sessions

**Why:** database sessions are mutually exclusive with the Credentials provider,
and Credentials is what powers the local sign-in button that lets the game run
without first registering a GitHub OAuth app. Keeping that meant keeping JWT.

**Traded away:** server-side session revocation. Acceptable for a game at
Phase 1; tracked as `session-revocation` in `BACKLOG.md` for before launch.

---

## D7 — Migrations run in CI, not in the Vercel build

**Why:** a Vercel build can be skipped by an Ignored Build Step, auto-cancelled
when another push lands on the same branch, or reverted by Instant Rollback.
Each leaves schema and code disagreeing while the deploy still reports success.
`.github/workflows/migrate.yml` runs migrations on merge to `main`, then seeds,
then runs `verify:rls` as a gate.

---

## D8 — Integration tests default to PGlite

**Why:** a row-level security policy that CI never runs is a policy nobody knows
is broken. Requiring a live credential would have meant it ran rarely;
requiring Docker would have meant it ran on some machines and not others. PGlite
is genuine Postgres 18, in-process, and runs the same migration files.

**The catch, which is real:** PGlite's default user is a superuser and bypasses
RLS. The suite therefore never asserts what the owner can see. It also masked
the `SET ROLE` grant bug completely — that only surfaced against live Neon. Set
`TEST_DATABASE_URL` and run the suite against a throwaway Neon branch before
trusting any database change.
