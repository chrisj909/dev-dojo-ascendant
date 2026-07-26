# Dojo Ascendant — working agreement

A browser game about raising students to mastery. You are a headmaster, not a
fighter. Read `DOJO_ASCENDANT_GDD.md` for what the game is and
`IMPLEMENTATION_SPEC.md` for how it is built.

**When the two disagree: the GDD wins on intent, the spec wins on numbers.**

@.claude/memory/MEMORY.md

---

## The rules that matter

**Stay in phase.** `IMPLEMENTATION_SPEC.md` §6 sequences the build and §8 warns
why: this design has enough interlocking systems that an unbounded session will
produce something plausible and wrong. The current phase is the
`current_phase:` line in `BACKLOG.md`. Do not start work belonging to a later
phase, even when it seems small, and do not begin a phase before the previous
one has a passing test suite.

**Tests before features.** SPEC §7 lists twelve numbered tests that encode the
design's load-bearing claims, and says to write them first. Tests 1, 2 and 12
exist. Each remaining one is a backlog item scheduled ahead of the feature it
covers.

**Every tuning number lives in `lib/constants.ts`.** Never inline a rate, cost,
cap, chance, multiplier or duration. This is what makes the game retunable in
one file instead of forty. A hook flags likely violations; it is advisory, so
read what it says rather than dismissing it.

**No cron for regeneration.** Energy, Focus, tuition and recovery are all
derived from stored timestamps on read (SPEC §2.1). A scheduled job that ticks
any of them is a P0 bug. Cron is reserved for genuinely global daily events —
recruit pool refresh, standings settlement, branch graduation checks.

**Server authority.** The client sends intent, never outcomes (SPEC §2.2).
Resolution, drops and drift all happen server-side from a stored seed. A client
component may _derive display values_ from server state — `ResourceBar` does
exactly that — but may never decide anything.

**Every player-owned table gets RLS in the migration that creates it.** Not the
next one. See `lib/db/rls.ts`, and use the `db-steward` subagent.

---

## Commands

```bash
npm run dev              # localhost:3000
npm run check            # format + types + lint + unit tests. Run before every commit.
npm run test:integration # real Postgres — PGlite by default, Neon if TEST_DATABASE_URL is set
npm run verify:rls       # is row-level security actually in force on the configured database
npm run db:generate      # after editing lib/db/schema.ts
npm run db:migrate       # apply migrations (direct endpoint)
npm run db:seed          # idempotent region seed
```

## Slash commands

| Command        | What it does                                                        |
| -------------- | ------------------------------------------------------------------- |
| `/dojo-loop`   | Take the top item from BUGTRAQ/BACKLOG, do it test-first, open a PR |
| `/dojo-bug`    | Reproduce, write a failing test, file into `BUGTRAQ.md`             |
| `/dojo-task`   | Add a backlog item with testable acceptance criteria                |
| `/dojo-ship`   | Commit, push, open a PR with a body worth reading                   |
| `/dojo-status` | Phase, open work, CI, database health                               |
| `/dojo-phase`  | Close the current phase — only after proving its gate               |

## Subagents

`spec-guardian` (design contract) · `test-author` (tests first) ·
`db-steward` (schema, migrations, RLS) · `balance-analyst` (simulate before
retuning) · `change-reviewer` (adversarial diff review) · `bug-triager`
(symptom → failing test → entry).

---

## Layout

```
app/            routes. Server components by default.
components/     'use client' only where interactivity requires it.
lib/
  constants.ts  ALL tuning values. Single source of truth.
  game/         pure logic. No I/O, no clock — time is always a parameter.
  db/           schema, client, RLS wrapper, seed data.
  repo/         database access. Everything goes through withPlayer().
  actions/      'use server'. Identity comes from the session, never the payload.
drizzle/        migrations. 0001 and 0002 are hand-written RLS.
scripts/        migrate, seed, verify-rls, create-app-role.
tests/unit/     pure. No database. What CI gates on.
tests/integration/  real Postgres.
docs/DECISIONS.md   why things are the way they are.
```

---

## Things that have already bitten

Each of these cost real time. They are in `.claude/memory/` in full.

- **Neon's `neondb_owner` holds BYPASSRLS.** Enabling and forcing RLS protects
  nothing on its own. The control is demoting to `app_user` per transaction.
- **Postgres 16 split role membership from the right to `SET ROLE`.** Test
  `pg_has_role(..., 'SET')`, never `'MEMBER'` — the latter reports true while
  every request dies.
- **PGlite's default user is a superuser** and bypasses RLS. Never assert what
  the owner can see. Run against real Neon before trusting a database change.
- **Drizzle wraps driver errors** — the Postgres message is on `error.cause`.
  A test matching `error.message` matches nothing.
- **Drizzle tracks migrations by timestamp, not content hash.** Editing an
  applied migration does nothing to a database that has seen it. Fix forward.
- **Regen must advance the timestamp by _all_ elapsed ticks,** not just the ones
  consumed before the cap. Otherwise a long absence banks invisibly and
  materialises the moment the player spends.

---

## Style

Match the surrounding code. Comments explain **why**, and specifically the thing
a reader would otherwise get wrong — not what the line does. Look at
`lib/game/resources.ts` for the standard.

Prettier runs automatically on save via a hook. Do not hand-format.

Never weaken a test to make it pass. If a test is genuinely wrong, that is its
own item with its own justification, and it goes in the diff where someone can
see it.
