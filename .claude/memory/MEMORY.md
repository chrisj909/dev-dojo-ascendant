# Project memory

Facts about this codebase that are **not** derivable from reading it — things
learned by running into them, decisions and their rejected alternatives, and
constraints imposed from outside.

One fact per file. Add a one-line pointer here when you add one. If a memory
turns out to be wrong, delete it; a stale memory is worse than none, because it
is trusted.

Do not record what the code already says. "The regen tick is 6 minutes" belongs
in `lib/constants.ts` and is already there. "Neon's owner role holds BYPASSRLS,
so FORCE RLS alone protects nothing" belongs here, because nothing in the
repository would tell you that.

## The database

- [Neon owner bypasses RLS](neon-owner-bypasses-rls.md) — why the app demotes to `app_user` instead of trusting FORCE.
- [SET ROLE needs the SET option](postgres-set-role-option.md) — the Postgres 16 change that made membership insufficient.
- [Driver is node-postgres, not Neon's](driver-choice-node-postgres.md) — transactions are required, which rules out the HTTP driver.
- [Integrity triggers need SECURITY DEFINER](integrity-triggers-need-security-definer.md) — RLS hides rows from a counting trigger, and it fails open.
- [Count checks need a lock](count-checks-need-a-lock.md) — count-then-decide is a race; CAS when you have a prior value, advisory lock when you aggregate.

## Game logic

- [Regen must advance the full elapsed ticks](regen-advance-all-ticks.md) — the banking exploit that tests 1 and 2 alone do not catch.
- [RNG output is a contract](rng-output-is-a-contract.md) — changing it silently re-rolls every stored battle report.

## Process, learned the hard way

- [Safety rules fail by looking right](safety-rules-fail-by-looking-right.md) — three controls here enforced nothing; test the guard, not just the feature.
- [Hooks load at session start](hooks-load-at-session-start.md) — the session that writes a hook is not governed by it.
- [stdout banners poison pipes](stdout-banners-poison-pipes.md) — dotenv greets you on stdout and corrupted a secret piped to `gh`.
- [Tests run on PGlite by default](tests-use-pglite.md) — real Postgres in-process, so RLS is covered in CI with no credentials.
- [Auth.js v5 is still beta](auth-js-still-beta.md) — pinned exactly, and why it was chosen anyway.
