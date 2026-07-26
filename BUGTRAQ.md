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

- [x] **P0** `set-role-missing-set-option` — Every request failed against real Neon with `permission denied to set role "app_user"`.
  - **Repro:** apply migrations to a fresh Neon database, run `npm run verify:rls`.
  - **Expected:** the owner can `SET ROLE app_user`. **Actual:** `permission denied`, while `pg_has_role(..., 'MEMBER')` reported true.
  - **Cause:** Postgres 16+ auto-grants a newly created role back to its creator with `set_option = false`. Membership and the right to `SET ROLE` are separate; the guard tested the wrong one.
  - **Fixed by:** `drizzle/0002_rls_set_role.sql`, and corrected in `drizzle/0001_rls.sql` for fresh installs.
  - **Missed because:** PGlite's superuser never needs the grant, so the whole suite was green. Recorded in `.claude/memory/postgres-set-role-option.md`.
  - **Filed / fixed:** 2026-07-25
