---
name: rng-output-is-a-contract
description: Changing the RNG algorithm or its seeding silently re-rolls every stored battle report; treat it as save-breaking.
metadata:
  type: project
---

`lib/game/rng.ts` is xoshiro128** seeded through splitmix32. Its exact output
sequence is a **compatibility contract**, not an implementation detail.

**Why:** SPEC §2.3 stores only `(seed, snapshot)` and regenerates battle reports
from them rather than persisting the prose. Change the algorithm, change the
seeding, or change the order in which a resolution draws numbers, and every
historical report in the database starts telling a different story — while every
behavioural test still passes, because each is individually still valid.

`tests/unit/rng.test.ts` pins a literal output sequence for exactly this reason.
That test does not check the generator is good; the distribution tests do. It
checks it never changes.

**How to apply:** if that pinned test fails, do not update the expected values to
make it pass. It is telling you the change is save-breaking, and the questions
are whether stored reports must be migrated or invalidated, and whether the
change is worth that.

The same applies to the _order of draws_ inside any resolution, which the test
cannot catch. Adding a roll in the middle of `resolve()` shifts every subsequent
draw and re-rolls the outcome. Append new draws at the end, or version the
resolver.
