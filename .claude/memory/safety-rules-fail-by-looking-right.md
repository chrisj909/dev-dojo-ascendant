---
name: safety-rules-fail-by-looking-right
description: Three controls in this repo were written, reviewed, believed, and did nothing. Test the guard, not just the feature.
metadata:
  type: project
---

Three separate safety controls in this project shipped in a state where they
read as protective and enforced nothing. None was caught by review; all three
were caught by adversarially attacking them afterwards.

1. **`ask` permission entries are inert** under `"defaultMode": "bypassPermissions"`
   and `--dangerously-skip-permissions`. `npm run db:migrate` sat in `ask` and
   the loop could have run it against production all along.
2. **The push-to-`main` rule** required the literal `main` preceded by
   whitespace. A bare `git push` while standing on main contains no such string,
   and `git push origin +main` defeated the force rule at the same time.
3. **The truncation guard** compared `new URL().hostname`. A trailing dot, an
   uppercase host, a percent-encoded database name, or `?host=` all reach the
   same database while comparing unequal — and `?host=` is the one node-postgres
   actually _prefers_, so the hostname being inspected was decorative.

**Why this keeps happening:** a guard's failure mode is silence. A broken
feature produces a complaint; a broken guard produces nothing at all, until the
day it was supposed to matter. Reviewing a rule confirms it does what it says —
not that what it says is what is needed.

**How to apply:** for anything whose job is to refuse, write the test that tries
to get past it, and write it adversarially — alternative spellings, different
casing, the same destination reached another way. `tests/unit/command-rules.test.ts`
and `tests/unit/database-target.test.ts` exist for this. Then break the guard on
purpose and confirm the tests fail; a guard test that passes with the guard
removed is worse than none, because it is reassuring.

Corollary: prefer sharing the parser with whatever you are guarding. The
truncation guard now resolves targets with `pg-connection-string`, the same
parser `pg` uses to decide where to connect, so guard and driver cannot disagree
about what a string means.
