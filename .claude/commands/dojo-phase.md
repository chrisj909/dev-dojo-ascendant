---
description: Close out the current build phase and open the next one, with the gate actually checked rather than assumed.
argument-hint: '[optional: the phase number to move to]'
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Agent
---

@BACKLOG.md

Target phase (may be empty — default is the next one): $ARGUMENTS

---

`IMPLEMENTATION_SPEC.md` §6: **do not start a phase until the previous one has a
passing test suite.** This command is where that is enforced, so do not treat it
as bookkeeping.

## 1. Prove the current phase is actually done

Do not take the checkboxes as evidence. Check the phase's **"Done when"**
condition from SPEC §6 directly:

- Phase 1 — log out, wait, log back in, and see correct Energy.
- Phase 2 — a student can be recruited and drilled from white belt to belt 2,
  and tuition accrues and collects correctly.
- Phase 3 — neglecting the roster measurably degrades it over 48 real hours.
- Phase 4 — two players drilling differently crystallise into different named
  archetypes.
- Phase 5 — a scouted counter-composition reliably beats a stronger but
  mismatched roster.
- Phase 6 — the day-90 simulation shape reproduces in live data on a
  time-accelerated harness.
- Phase 7 — a scripted player climbs Backyard to Regional on an accelerated
  clock without hitting a design dead-end.

Demonstrate it. Run the test, run the harness, show the output. "The boxes are
ticked" is not a demonstration.

Then:

```bash
npm run check
npm run test:integration
npm run verify:rls
```

Every numbered test from SPEC §7 that belongs to this phase must exist and pass.
List them by name with their status.

## 2. If it is not done

Say exactly what is missing and stop. Do not advance the phase. Do not offer to
advance it anyway. The sequencing is the main defence this project has against
building something plausible and wrong.

## 3. If it is done

- Update `current_phase:` in `BACKLOG.md`.
- Populate the next phase's items from SPEC §6, each with testable acceptance
  criteria, using the same format `/dojo-task` produces.
- Add the SPEC §7 tests belonging to the new phase as explicit items, marked to
  be written **before** the features they cover.
- Record in `docs/DECISIONS.md` anything decided during the closing phase that a
  future reader would otherwise have to reverse-engineer.

## 4. Report

What closed the phase, with evidence. What the next phase contains. The first
item `/dojo-loop` will pick up.
