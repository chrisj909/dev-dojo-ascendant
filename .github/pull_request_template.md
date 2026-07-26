## What

<!-- One paragraph. What behaviour is different now. -->

## Why

<!-- The BUGTRAQ/BACKLOG slug this closes, and the governing section
     (e.g. "SPEC §7 test 2", "GDD §9.4"). -->

## How it was verified

<!-- Name the test that now passes and what it asserts. A PR whose only
     evidence is "tests pass" is not reviewable. -->

- [ ] `npm run check`
- [ ] `npm run test:integration` — backend: <!-- pglite | neon -->
- [ ] `npm run verify:rls` — required if the database was touched
- [ ] Stays within the current phase (`current_phase:` in `BACKLOG.md`)
- [ ] Any new tuning value lives in `lib/constants.ts`

## Deliberately not done

<!-- Anything in scope that was left, and why. "Nothing" is a fine answer. -->

## Risk

<!-- What breaks if this is wrong, and how it would show up. -->
