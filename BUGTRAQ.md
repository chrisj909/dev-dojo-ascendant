<!--
  Parsed by .claude/hooks/session-context.mjs and /dojo-loop. The format below
  is a contract — an entry that does not match is invisible to the loop.

  File bugs with /dojo-bug. It reproduces first, writes a failing test, and only
  then writes the entry. A bug without a failing test is a rumour.
-->

# Bug tracker

Priority decides what `/dojo-loop` picks up next. P0 outranks the entire
backlog.

- **P0** — data loss, cross-tenant exposure, an economy exploit, or a broken
  build. Anything letting a player see or change another player's rows is P0
  regardless of how hard it is to trigger. Anything manufacturing Energy, Focus
  or tuition from nothing is P0, because currency exploits cannot be unwound
  once they spread.
- **P1** — a system does not do what the GDD says it does.
- **P2** — cosmetic, a rough edge, a slow query nobody has noticed.

Entry format:

```markdown
- [ ] **P1** `slug-in-kebab-case` — One line on the symptom.
  - **Repro:** the smallest sequence that shows it.
  - **Expected:** … **Actual:** …
  - **Test:** `tests/unit/x.test.ts` › "name of the failing case"
  - **Suspect:** file and function, or `unknown`
  - **Filed:** YYYY-MM-DD
```

---

## Open

_None._

Phase 1 shipped with `npm run check`, `npm run test:integration` (against both
PGlite and live Neon) and `npm run verify:rls` all green.

---

## Known limitations — accepted, not bugs

These are documented properties rather than defects. They are here so nobody
files them twice.

- **`SET ROLE` can be undone when the pool connects as the database owner.**
  Postgres authorises `SET ROLE` against the _session_ user, so code running
  inside `withPlayer()` can name the owner role and climb back out. Reaching it
  requires executing arbitrary SQL, and every query is parameterised through
  drizzle. Closed by setting `APP_DATABASE_URL` — see the
  `app-database-url-in-production` item in `BACKLOG.md`. Asserted, rather than
  assumed away, in `tests/integration/rls.test.ts`.

- **No server-side session revocation.** JWT sessions were chosen so the
  passwordless local sign-in could coexist with OAuth. Tracked as
  `session-revocation` in `BACKLOG.md`.

- **`dojos` is owner-only under RLS,** so nothing can currently browse rivals.
  That is correct for Phase 1 and becomes a Phase 5 design task — scouting needs
  a deliberate world-readable projection, not a loosened `dojos_own` policy.

---

## Fixed

- [x] **P0** `harness-guards-did-not-guard` — Two controls in the agent harness read as protective and were not.
  - **Found by:** the adversarial QA sweep, after both had shipped.
  - **1. Pushes to `main` were not blocked.** The rule required the literal `main` preceded by whitespace, so a bare `git push` while standing on main passed, as did `git push -u origin HEAD`. `git push origin +main` defeated the main rule and the force rule at once. `/dojo-ship` names this hook as its enforcement.
  - **2. The loop could migrate and seed production.** `db:migrate`, `db:seed`, `db:app-role` and `drizzle-kit push` all resolve `DATABASE_URL` from `.env.local` — the live database. The only guard was an `ask` permission entry, which is **inert** under `"defaultMode": "bypassPermissions"` plus `--dangerously-skip-permissions`. `db-steward`'s own instructions told it to run `npm run db:migrate`, so the loop would reach for it on any schema item and apply unreviewed DDL to production, contradicting D7.
  - **Also:** the `.env` rules enumerated `cat|type|Get-Content`, so `head`, `grep`, `less` and `node -e` all read secrets into the transcript; and the hook exited 0 — allowing the command — on empty or malformed stdin.
  - **Fixed by:** rules extracted to `.claude/hooks/command-rules.mjs` and covered by `tests/unit/command-rules.test.ts` (16 cases). Branch resolved with `git rev-parse` so implicit pushes are caught. Env rules match the file path rather than an allow-list of readers. The hook now **fails closed** on unreadable input, and refuses a `git push` when the branch cannot be determined. `db-steward.md` and `CLAUDE.md` rewritten to state that applying migrations is CI's job, not an agent's.
  - **Verified:** end to end through the hook's real stdin contract, not just the unit tests.
  - **Filed / fixed:** 2026-07-26

- [x] **P1** `truncation-guard-bypassable` — The guard added in #3 was defeated by four connection-string spellings.
  - **Cause:** it compared `new URL().hostname` and `.pathname` with only lowercasing and `-pooler` stripping. A trailing dot, an uppercase host, a percent-encoded database name, and `?host=` all reach the identical database while comparing unequal. `?host=` is the sharpest — node-postgres **prefers it over the URL authority**, so the hostname the guard inspected was decorative.
  - **Fixed by:** resolving the target with `pg-connection-string`, the same parser `pg` uses to decide where to connect, so the guard and the driver cannot disagree about what a string means. Also fails closed when either string is unparseable, instead of reporting "not the same database".
  - **Test:** `tests/unit/database-target.test.ts`, 23 cases, one per bypass.
  - **Filed / fixed:** 2026-07-26

- [x] **P0** `dojo-creation-redirect-loop` — Creating a dojo did nothing: the form blanked, stayed put, and said nothing.
  - **Repro:** hold a valid session whose `users` row has been deleted, then submit the creation form.
  - **Expected:** a clear message and a route out. **Actual:** an endless bounce between `/create` and `/dojo`, form cleared each time, nothing created, nothing explained.
  - **Cause:** two defects compounding.
    1. `createPlayerAndDojo` classified write failures with a regex over the error message. `/players_user_id/` was written for the unique constraint `players_user_id_unique` and also matched the foreign key `players_user_id_users_id_fk`. Drizzle derives both names from table and column, so any substring rule confuses them. A dangling user reference was therefore reported as `already_exists`, which redirected to `/dojo`, which found no dojo and redirected back to `/create`.
    2. Sessions are JWTs and outlive the `users` row they name (D6). Nothing detected that, so the landing page routed a ghost session onward to a form where every submit failed on a foreign key.
  - **Fixed by:** `lib/db/write-errors.ts` classifies by SQLSTATE plus exact constraint name, with an explicit table rather than patterns. New `stale_session` outcome signs the user out and explains why — redirecting alone was not enough, because the token stayed valid and the landing page routed them straight back. `app/page.tsx` no longer routes a session whose user row is missing. `lib/actions/onboarding.ts` restructured so every `redirect()` sits outside every `try` (Next implements redirect by throwing, so a broad catch swallows it) and every failure returns a message.
  - **Test:** `tests/unit/write-errors.test.ts` (15) and `tests/integration/onboarding.test.ts` (12). Both verified by mutation — reinstating the old classification fails them.
  - **Also fixed:** the `already_exists` path now confirms a dojo really exists before redirecting to it, so a future misclassification degrades to a message instead of a loop.
  - **Filed / fixed:** 2026-07-26

- [x] **P0** `test-suite-truncated-app-database` — The integration suite emptied the live database.
  - **Repro:** set `TEST_DATABASE_URL` to the same Neon database as `DATABASE_URL`, run `npm run test:integration`.
  - **Expected:** refuse to run. **Actual:** truncated every table between tests, deleting 5 of 6 regions and every user row.
  - **Symptom reaching the player:** "That region is not open to new dojos" on submitting the dojo creation form, with the form blanked. Nothing in that message points at the cause.
  - **Cause:** `tests/integration/harness.ts` truncates all tables in `beforeEach`. Nothing checked that the target was not the database the application was serving from. `.env.example` warned about it in a comment; a comment is not a control.
  - **Fixed by:** `tests/support/database-target.ts` — the harness now refuses when `TEST_DATABASE_URL` resolves to the same host and database as `DATABASE_URL` or `DATABASE_URL_UNPOOLED`. Neon's pooled and direct endpoints normalise to the same target, so the pooled string is not a way around it. No override: there is no legitimate reason to truncate a live database.
  - **Test:** `tests/unit/database-target.test.ts` — 13 cases, including the exact pooled/direct pairing that caused this.
  - **Blast radius:** no player progress lost. Dojo creation had not completed, so only reference data and an unused auth row existed. Regions restored with `npm run db:seed`; fixture rows deleted.
  - **Filed / fixed:** 2026-07-26

- [x] **P0** `set-role-missing-set-option` — Every request failed against real Neon with `permission denied to set role "app_user"`.
  - **Repro:** apply migrations to a fresh Neon database, run `npm run verify:rls`.
  - **Expected:** the owner can `SET ROLE app_user`. **Actual:** `permission denied`, while `pg_has_role(..., 'MEMBER')` reported true.
  - **Cause:** Postgres 16+ auto-grants a newly created role back to its creator with `set_option = false`. Membership and the right to `SET ROLE` are separate; the guard tested the wrong one.
  - **Fixed by:** `drizzle/0002_rls_set_role.sql`, and corrected in `drizzle/0001_rls.sql` for fresh installs.
  - **Missed because:** PGlite's superuser never needs the grant, so the whole suite was green. Recorded in `.claude/memory/postgres-set-role-option.md`.
  - **Filed / fixed:** 2026-07-25
