---
name: count-checks-need-a-lock
description: Any "count the rows, then decide" constraint needs a per-entity advisory lock, or two concurrent writers both pass.
metadata:
  type: project
---

A constraint implemented as _count the existing rows, compare to a limit, allow
or refuse_ is a race under READ COMMITTED, which is Postgres's default and this
project's. Two concurrent writers both read `limit - 1`, both conclude there is
room, and both succeed.

The roster cap trigger takes `pg_advisory_xact_lock(hashtext(dojo_id::text))`
before counting. Scoped to one dojo and released with the transaction, so
unrelated players never contend.

**Why:** GDD §4.1 calls the roster cap a _hard_ cap — "This is a dojo, not a
barracks" — and a cap that two simultaneous recruits can step past is not hard,
it is usually-enforced. The window is small, which is precisely what makes it
the kind of bug that survives to production and then reproduces once a week.

**How to apply:** every remaining count-based limit in the design has the same
shape and needs the same treatment — patronage slots (GDD §9.4), the six-scroll
set (§7.1), squad size (§8.1), the recruit pool (§4.3). Related but distinct:
resource spends use a compare-and-swap `UPDATE` instead, because there the old
value is known and can be pinned in the `WHERE` — see `spendEnergy` in
lib/repo/dojo.ts. Use CAS when you have a prior value, an advisory lock when you
have to aggregate. See also [[integrity-triggers-need-security-definer]].
