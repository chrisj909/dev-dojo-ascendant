---
name: regen-advance-all-ticks
description: Lazy regen must advance the stored timestamp by every elapsed tick, not only those consumed before hitting the cap.
metadata:
  type: project
---

`regenerate()` in `lib/game/resources.ts` always advances `updatedAt` by
`floor(elapsed / regenMs) * regenMs`, even when the value clamps at the cap. And
it never sets `updatedAt` to `now`.

**Why:** both halves are exploits, and both look correct while being written.

Advancing only by the ticks actually consumed (`cap - value`) leaves the
remainder of a long absence sitting in the timestamp. Thirty days offline, drain
the bar, and it refills instantly — a month of banked Energy. Setting
`updatedAt = now` on a spend instead discards the fraction of a tick the player
had already waited through, which is the failure SPEC §7 test 2 exists to catch.

Together the two rules pin the stored timestamp into the half-open window
`(now - regenMs, now]`.

**How to apply:** SPEC tests 1 and 2 both pass against an implementation
carrying the banking exploit. The `at cap — elapsed time must not bank
invisibly` block in `tests/unit/resources.test.ts` is what actually catches it.
Any new lazily-regenerated quantity — tuition accrual, injury recovery, recruit
pool refresh — must reuse `regenerate()` rather than re-deriving the arithmetic,
and must carry the same anti-banking test.
