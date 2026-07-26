---
name: integrity-triggers-need-security-definer
description: A trigger that counts rows to enforce an invariant must be SECURITY DEFINER, because RLS hides rows from it and it fails open.
metadata:
  type: project
---

Any trigger that enforces an invariant by **counting rows** must be declared
`SECURITY DEFINER` with a pinned `search_path`. The roster cap trigger
(`app.enforce_roster_cap`, drizzle/0005) is the first of these.

**Why:** running as the caller, row-level security filters what the trigger can
see. It would count only the rows the current identity is allowed to read —
and in any context without `app.user_id` set, that is **zero**. The trigger
would then cheerfully report an empty roster and let the cap be blown past. An
integrity check that cannot see the whole table is not one, and this failure
mode is silent: everything appears to work.

The same reasoning applies to any future check of this shape — patronage slots
per dojo (GDD §9.4), scrolls per set (§7.1), squad size (§8.1).

**How to apply:** `SECURITY DEFINER` without `SET search_path` is a
privilege-escalation hole, because the caller controls name resolution and can
shadow a function or table the body calls. Always pin it:
`SET search_path = public, pg_catalog`.

And add the advisory lock — see [[count-checks-need-a-lock]]. A count-then-check
without one is a race, not a constraint.
