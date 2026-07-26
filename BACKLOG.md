<!--
  Parsed by .claude/hooks/session-context.mjs and /dojo-loop. The format below
  is a contract — an entry that does not match is invisible to the loop.

  current_phase drives phase-scope enforcement. Only /dojo-phase changes it, and
  only after the phase's "Done when" condition in IMPLEMENTATION_SPEC.md §6 has
  actually been demonstrated.
-->

current_phase: 2 — Roster & drills

# Backlog

Sequenced by `IMPLEMENTATION_SPEC.md` §6. **Do not start a phase until the
previous one has a passing test suite.**

Entry format:

```markdown
- [ ] **P1** `slug-in-kebab-case` — One line on what this is.
  - **Why:** SPEC §x / GDD §y
  - **Done when:** something testable, not something felt.
  - **Constants:** NEW_CONSTANT_NAME (if it introduces any)
```

---

## Phase 1 — Skeleton ✅ complete

Auth, player creation, dojo creation, region seed data, lazy Energy/Focus regen,
one screen with bars that tick.

**Done when:** you can log out, wait, log in, and see correct Energy. —
demonstrated by rewinding `energy_updated_at` 10 hours against live Neon and
reading exactly 55/55 rather than 110.

- [x] **P0** `spec-test-1-energy-regen-gap` — 10-hour offline gap lands exactly on cap.
- [x] **P0** `spec-test-2-partial-tick-spend` — spending at a partial tick keeps the remainder.
- [x] **P0** `spec-test-12-rls-cross-tenant` — RLS blocks cross-player reads and writes.
- [x] **P0** `lazy-regen-core` — `regenerate`/`spend`, no cron, integer tick maths.
- [x] **P0** `schema-and-rls` — full SPEC §3 schema, `app_user` role, policies on every owned table.
- [x] **P1** `auth-and-onboarding` — Auth.js v5, player + dojo creation in one transaction.
- [x] **P1** `region-seed-data` — six regions, idempotent seeding by slug.
- [x] **P1** `dojo-screen` — Energy and Focus bars derived client-side from the same pure function.

---

## Phase 2 — Roster & drills

**Done when:** a student can be recruited, drilled from white belt to belt 2, and
tuition accrues and collects correctly.

- [ ] **P0** `spec-test-3-roster-cap` — Roster cap cannot be exceeded by recruiting, poaching, or graduation reversal.
  - **Why:** SPEC §7 test 3, GDD §4.1
  - **Done when:** a test proves all three routes are refused at `ROSTER_CAP_BY_TIER[tier]`, and the cap is enforced by a database constraint rather than only in application code.
  - **Note:** write this before any recruitment code exists.

- [ ] **P0** `student-generation` — Generate a student with attributes, aptitudes, temperament and background.
  - **Why:** GDD §4.2
  - **Done when:** generation is deterministic from a seed (SPEC §2.3), and 1000 seeded students produce attribute distributions within the documented band for a given region's `recruit_quality`.
  - **Constants:** `STUDENT_ATTRIBUTE_MIN`, `STUDENT_ATTRIBUTE_MAX`, `APTITUDE_MIN`, `APTITUDE_MAX`, `TEMPERAMENTS`, `RECRUIT_QUALITY_ATTRIBUTE_BONUS`

- [ ] **P1** `recruit-pool` — Region-specific pool that refreshes on a timer.
  - **Why:** GDD §4.3
  - **Done when:** the pool is derived lazily from a timestamp exactly as Energy is (no cron), reloading cannot reroll it, and pool quality scales with Presence and region `recruit_quality`.
  - **Constants:** `RECRUIT_POOL_SIZE`, `RECRUIT_POOL_REFRESH_MS`, `RECRUIT_COST_TUITION`

- [ ] **P1** `drill-assignment` — Assign a drill to a student; it costs Energy and resolves on a timer.
  - **Why:** GDD §6, SPEC §4
  - **Done when:** the Energy spend goes through the compare-and-swap path in `lib/repo/dojo.ts`, and two simultaneous submissions cannot both succeed.
  - **Constants:** already present — `DRILL_COST`, `DRILL_XP_BASE`, `DRILL_XP_TECHNIQUE_DIVISOR`

- [ ] **P1** `curriculum-stages` — Foundation → Form → Application, each gated on the last.
  - **Why:** GDD §6.1
  - **Done when:** a student walks white belt → belt 2 in a test, stage gating refuses out-of-order entry, and re-running a completed curriculum still pays at `REPEAT_PAYOUT_RATE`.
  - **Note:** the repeat payout is load-bearing. Energy caps overnight, so there must always be something to spend it on (GDD §6.1).

- [ ] **P1** `facility-tuition` — Facilities generate tuition on a timer, collected manually, capped at 8 hours.
  - **Why:** GDD §12, SPEC §4 `TUITION_CAP_HOURS`
  - **Done when:** accrual is lazy from `collected_at`, the 8-hour cap holds across a 30-day gap, and collecting at a partial tick does not discard the remainder — the same anti-banking property as Energy. Reuse `regenerate()`.

- [ ] **P1** `starting-economy-bootstrap` — Decide what a dojo can afford on day one.
  - **Why:** GDD §4.3 makes recruiting cost tuition; GDD §12 makes facilities generate it. `STARTING_TUITION` now follows SPEC §3 at 0, which means a brand-new dojo can afford nothing until a facility has produced something. That may be correct — the first session is meant to be about drills, not shopping — or it may be a dead start.
  - **Done when:** a simulation shows the day-1 to day-3 experience under both a 0 and a non-zero opening balance, and the chosen value is recorded in `docs/DECISIONS.md` with the evidence. Use the **balance-analyst** subagent; do not simply pick a number.
  - **Note:** 500 was in the code for the whole of Phase 1 as an undocumented deviation from the spec. It was removed rather than blessed, because a number nobody decided is worse than either answer.

- [ ] **P2** `style-vector-accumulation` — Every drill nudges the school's style vector.
  - **Why:** GDD §6.2, §7.2
  - **Done when:** drilling differently produces measurably different vectors. Crystallisation itself is Phase 4; only accumulation lands here.

---

## Phase 3 — Decay

**Done when:** neglecting the roster measurably degrades it over 48 real hours.

- [ ] **P0** `spec-test-8-loyalty-high-performer` — Loyalty decays faster for belt ≥ 3 than below, all else equal.
  - **Why:** SPEC §7 test 8, GDD §11
  - **Note:** this rule exists to stop "build one superstar and coast" being dominant. Test the strategy, not just the arithmetic.

- [ ] **P1** `injury-and-recovery` — Application drills and challenge losses cause injury; recovery is time-based.
  - **Why:** GDD §11
  - **Done when:** recovery is derived from `recovers_at` with no cron, and a third injury applies the permanent attribute penalty.

- [ ] **P1** `loyalty-decay` — Passive decay, resisted by Mental, restored by wins and shrine income.
  - **Why:** GDD §11
  - **Done when:** decay is lazy from a timestamp and 48 simulated hours of neglect produce a measurable, asserted drop.

---

## Phase 4 — Scrolls & style

**Done when:** two players drilling differently crystallise into different named archetypes.

- [ ] **P1** `scroll-drops-and-sets` — Drop tables per curriculum stage; six scrolls complete a set.
  - **Why:** GDD §7.1, SPEC §4 `SCROLL_DROP_RATE`
- [ ] **P1** `style-crystallization` — Fires at `CRYSTALLIZE_THRESHOLD`; the player names the school.
  - **Why:** GDD §7.2. Open question GDD §15.4 — does it arrive too late to matter? Instrument the day it fires.

---

## Phase 5 — Challenges

**Done when:** a scouted counter-composition reliably beats a stronger but mismatched roster.

- [ ] **P0** `spec-test-4-tier-range-and-shield` — Cannot target outside ±1 tier, or a shielded dojo.
- [ ] **P0** `spec-test-5-squad-order-matters` — Same ten students, different slot order, different result.
- [ ] **P0** `spec-test-6-matchup-65-35` — Style-advantaged inferior roster wins ~65% over 1000 seeded runs.
- [ ] **P0** `spec-test-7-poach-window` — A dojo cannot be poached from twice inside `POACH_WINDOW_HOURS`.
- [ ] **P0** `spec-test-11-reproducible-resolution` — Every resolution reproduces from `(seed, snapshot)`.
- [ ] **P1** `challenge-resolution` — SPEC §5.1, server-seeded, snapshot on resolve.
  - **Note:** `dojos` is currently owner-only under RLS. Scouting needs a world-readable projection — design it as a view or an explicit policy, not by loosening `dojos_own`.

---

## Phase 6 — Lineage

**Done when:** the day-90 simulation shape reproduces in live data on a time-accelerated harness.

- [ ] **P0** `spec-test-9-dormant-tribute-rate` — Dormant branches produce exactly `DORMANT_TRIBUTE_RATE` of patronised tribute.
- [ ] **P0** `spec-test-10-both-pure-policies-stall` — Pure breadth stalls before National; pure depth stalls before Regional. **Both must fail.**
- [ ] **P1** `graduation-and-branch-founding` — GDD §9.1–9.3, style drift per SPEC §5.3.
- [ ] **P1** `patronage-slots` — GDD §9.4. The daily evaluation in SPEC §5.4 is the one legitimate cron in the design.

---

## Phase 7 — Tiers & world

**Done when:** a scripted player climbs Backyard → Regional on an accelerated clock without a design dead-end.

- [ ] **P1** `tier-gates` — GDD §10, alternating breadth and depth on purpose.
- [ ] **P1** `established-schools` — PvE opponents and the difficulty curve. GDD §13.

---

## Unphased

Things worth doing that do not belong to a phase.

- [ ] **P1** `app-database-url-in-production` — Provision the `app_user` login role and set `APP_DATABASE_URL` before any public deploy.
  - **Why:** `SET ROLE` is authorised against the session user, so an owner-connected pool can climb back out. Documented in `lib/db/rls.ts` and asserted in the integration suite.
  - **Done when:** `APP_DATABASE_URL` is set in Vercel and the escalation test in `tests/integration/rls.test.ts` takes its hardened branch.

- [ ] **P2** `session-revocation` — Revisit JWT sessions before launch.
  - **Why:** JWT was chosen to keep the passwordless local login working. There is no server-side revocation. See `.claude/memory/auth-js-still-beta.md`.

- [ ] **P2** `ci-against-neon-branch` — Run the integration suite against a throwaway Neon branch on a schedule.
  - **Why:** PGlite's superuser masks grant bugs — that is precisely how the `SET ROLE` bug reached a running database. See `.claude/memory/postgres-set-role-option.md`.
