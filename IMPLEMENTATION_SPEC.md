# DOJO ASCENDANT — IMPLEMENTATION SPEC

> Companion to `DOJO_ASCENDANT_GDD.md`. This file is the build contract: stack,
> schema, constants, algorithms, phases. When design and spec disagree, the GDD
> wins on intent and this file wins on numbers.

---

## 1. STACK

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | One codebase, server actions give free server authority |
| DB / Auth | Supabase (Postgres + RLS) | Row-level security maps cleanly to "players only mutate their own dojo" |
| Hosting | Vercel | Zero-config, preview deploys per branch |
| State | Server-authoritative. Client renders, never computes | Anti-cheat; also makes offline progression trivial |
| Styling | Tailwind | Mobile-first, no design system overhead at MVP |

No game engine. No websockets at MVP — everything is request/response.

---

## 2. ARCHITECTURAL PRINCIPLES

### 2.1 Lazy time evaluation — no cron for regen

**Never** run a scheduled job to tick Energy, Focus, tuition, or recovery. Store
a timestamp and compute current value on read:

```ts
function currentEnergy(row: Dojo, now: Date): number {
  const elapsedMs = now.getTime() - row.energy_updated_at.getTime();
  const gained = Math.floor(elapsedMs / ENERGY_REGEN_MS);
  return Math.min(row.energy + gained, energyCap(row));
}
```

On any spend: recompute, deduct, write back both value and a *floor-adjusted*
timestamp so partial ticks aren't lost.

Cron is used only for genuinely global events: recruit pool refresh, region
standings settlement, branch graduation checks. Those run daily, not per-second.

### 2.2 Server authority

Every state mutation goes through a server action or route handler. The client
sends intent (`challenge(defenderId, [studentIds])`), never outcomes. Combat
resolution, drops, and drift all happen server-side with a server-seeded RNG.

### 2.3 Determinism and replay

Seed every resolution with a stored seed. Battle reports are regenerated from
`(seed, snapshot)` rather than stored as prose — cheaper, and lets you re-render
reports if presentation changes.

### 2.4 Snapshot on resolve

Challenges snapshot both rosters at resolve time into the battle record. Never
join live student rows into a historical report; students change.

---

## 3. DATA MODEL

Postgres. `snake_case`. All tables have `id uuid pk default gen_random_uuid()`,
`created_at timestamptz default now()`.

```
players
  user_id            uuid  -> auth.users
  handle             text unique
  headmaster_name    text
  nationality        text
  technique          int   default 5
  mental             int   default 5
  presence           int   default 5
  stamina            int   default 5
  discipline         int   default 5

dojos
  player_id          uuid -> players
  name               text
  tier               int  default 0        -- 0..4
  region_id          uuid -> regions
  tuition            bigint default 0
  energy             int
  energy_updated_at  timestamptz
  focus              int
  focus_updated_at   timestamptz
  style_vector       jsonb                 -- see §5.2
  style_crystallized boolean default false
  style_name         text
  reputation         int default 0
  shield_until       timestamptz           -- new player protection

students
  dojo_id            uuid -> dojos
  name               text
  strength speed technique stamina mental   int
  apt_striking apt_grappling apt_internal apt_weapons  int
  temperament        text
  belt               int default 0
  curriculum_stage   int default 0         -- 0 foundation 1 form 2 application
  curriculum_progress int default 0
  loyalty            int default 70
  condition          text default 'healthy'
  recovers_at        timestamptz
  injury_count       int default 0
  poachable_until    timestamptz
  is_graduated       boolean default false

branches
  parent_dojo_id     uuid -> dojos          -- null if parent is a branch
  parent_branch_id   uuid -> branches
  founder_name       text
  generation         int
  region_id          uuid -> regions
  tier               int default 0
  own_graduates      int default 0
  style_vector       jsonb
  patronized         boolean default false
  loyalty            int default 70
  founded_at         timestamptz
  last_graduation_at timestamptz
  status             text default 'active'  -- active | dormant | defected

scrolls
  dojo_id            uuid -> dojos
  family             text
  index              int                    -- 0..5 within set
  
techniques           -- unlocked signature moves
  dojo_id            uuid -> dojos
  family             text
  unlocked_at        timestamptz

facilities
  dojo_id            uuid -> dojos
  kind               text
  level              int default 1
  collected_at       timestamptz

regions
  name               text
  recruit_quality    int
  scroll_families    text[]
  character_vector   jsonb                  -- pulls branch drift

challenges
  attacker_dojo_id   uuid
  defender_dojo_id   uuid
  seed               bigint
  attacker_snapshot  jsonb
  defender_snapshot  jsonb
  result             text                   -- attacker_win | defender_win
  resolved_at        timestamptz

drill_log
  student_id         uuid
  category           text
  logged_at          timestamptz
```

**RLS:** players read/write only rows reachable from their own `dojos.player_id`.
Challenges are readable by both participants. Branch and region rows are
world-readable.

---

## 4. TUNING CONSTANTS

Single source of truth. Put these in `lib/constants.ts` and never inline a magic
number anywhere else.

```ts
// --- Resources ---
export const ENERGY_REGEN_MS   = 6 * 60 * 1000;   // 1 per 6 min
export const ENERGY_CAP_BASE   = 50;              // + stamina
export const FOCUS_REGEN_MS    = 60 * 60 * 1000;  // 1 per hour
export const FOCUS_CAP_BASE    = 5;               // + floor(stamina/10)
export const TUITION_CAP_HOURS = 8;

// --- Drills ---
export const DRILL_COST = { foundation: 1, form: 2, application: 3 };
export const DRILL_XP_BASE = 10;                  // x (1 + technique/20)
export const CURRICULUM_LENGTH = { foundation: 12, form: 18, application: 24 };
export const REPEAT_PAYOUT_RATE = 0.35;           // completed curriculum re-runs
export const SCROLL_DROP_RATE = { foundation: 0.02, form: 0.05, application: 0.09 };

// --- Injury / loyalty ---
export const INJURY_CHANCE_APPLICATION = 0.06;    // x (1 - discipline/25)
export const INJURY_RECOVERY_HOURS = 18;          // x facility modifier
export const PERMANENT_PENALTY_AT_INJURIES = 3;
export const LOYALTY_DECAY_PER_DAY = 2;           // x (1 - mental/30)
export const LOYALTY_DECAY_HIGH_PERFORMER = 3.5;  // belt >= 3
export const LOYALTY_LOSS_ON_DEFEAT = 8;

// --- Roster ---
export const ROSTER_CAP_BY_TIER = [8, 9, 10, 11, 12];

// --- Challenges ---
export const CHALLENGE_FOCUS_COST = 2;
export const SCOUT_FOCUS_COST = 1;
export const CHALLENGE_SQUAD_SIZE = 5;
export const TIER_RANGE = 1;                      // +/- 1 dojo tier
export const MATCHUP_MULTIPLIER = 1.45;           // advantaged side
export const WEAPONS_BONUS = 1.25;                // vs all
export const WEAPONS_FRAGILITY = 0.7;             // stamina pool multiplier
export const POACH_WINDOW_HOURS = 24;
export const POACH_IMMUNE_BELT = 1;               // belt <= 1 not poachable
export const NEW_PLAYER_SHIELD_DAYS = 7;

// --- Lineage (validated by simulation, see GDD §12) ---
export const PATRONAGE_SLOTS_BY_TIER = [3, 4, 5, 6, 7];
export const BRANCH_GRADUATION_DAYS = 28;         // patronized only
export const BRANCH_TIER_UP_GRADUATES = 3;
export const DORMANT_TRIBUTE_RATE = 0.25;
export const DORMANT_ATTRITION_PER_DAY = 0.004;
export const STYLE_DRIFT_SIGMA = 0.08;
export const REGION_PULL = 0.15;

// --- Style ---
export const CRYSTALLIZE_THRESHOLD = 400;         // total weighted drills
export const RECRYSTALLIZE_COST_TUITION = 25000;
```

### 4.1 The number that matters most

`BRANCH_GRADUATION_DAYS` combined with the player's own ~10-day graduation cadence
is what governs whether the lineage tree is readable. Simulation results at these
values:

| Day | Total nodes | Live (patronized) | Generations present |
|---|---|---|---|
| 30 | 3 | 3 | 1 |
| 90 | ~14 | 4 | 1–2 |
| 180 | ~28 | 5 | 1–3 |
| 365 | ~51 | 5 | 1–4 |

Tune here first when the game feels wrong. Everything else is secondary.

---

## 5. ALGORITHMS

### 5.1 Challenge resolution

```
resolve(attackerSquad[5], defenderSquad[5], seed):
  rng = seeded(seed)
  score = 0
  for i in 0..4:
    a = attackerSquad[i]; d = defenderSquad[i]
    aPower = power(a); dPower = power(d)
    aPower *= matchupMultiplier(a.style, d.style)
    dPower *= matchupMultiplier(d.style, a.style)
    aPower *= 1 + rng.range(-0.12, 0.12)
    dPower *= 1 + rng.range(-0.12, 0.12)
    if aPower > dPower: score += 1 else: score -= 1
    record(pairLog[i])
  return score > 0 ? 'attacker_win' : 'defender_win'

power(s) = (strength*0.9 + speed*0.8 + technique*1.1 + stamina*0.7 + mental*0.6)
           * beltMultiplier(s.belt)
           * conditionMultiplier(s.condition)
           * (0.85 + loyalty/200)
```

Pairing is by squad slot order — the player's ordering is part of the decision.
Surface this clearly in the UI or the whole scouting layer is wasted.

### 5.2 Style vector

```ts
type StyleVector = {
  striking: number; grappling: number; internal: number; weapons: number;
  aggression: number; patience: number; precision: number; power: number;
};
```

Every drill adds weight to its category and its sub-axes. Dominant category
determines PvP style for matchup purposes. Crystallization fires when total
weight crosses `CRYSTALLIZE_THRESHOLD`; the game classifies the shape into a
named archetype and prompts the player to name the school.

### 5.3 Branch drift on founding

```
child.vector = normalize(
  parent.vector
  + gaussian(0, STYLE_DRIFT_SIGMA)
  + REGION_PULL * (region.character_vector - parent.vector)
)
```

### 5.4 Patronage evaluation (daily cron)

```
for each dojo:
  slots = PATRONAGE_SLOTS_BY_TIER[dojo.tier]
  enforce: count(branches where patronized) <= slots   -- player assigns manually
  for each branch:
    if patronized:
      if daysSince(last_graduation_at) >= BRANCH_GRADUATION_DAYS:
        spawn child branch; own_graduates += 1
        if own_graduates >= BRANCH_TIER_UP_GRADUATES: tier += 1
    else:
      tribute *= DORMANT_TRIBUTE_RATE
      loyalty -= 0.5
      if rng() < DORMANT_ATTRITION_PER_DAY: status = 'defected'
  reevaluate dojo tier gates
```

---

## 6. BUILD PHASES

Sequenced so that every phase ends on something playable. Do not start a phase
until the previous one has a passing test suite.

### Phase 1 — Skeleton
Auth, player creation, dojo creation, region seed data. Energy/Focus with lazy
regen. One screen showing bars that actually tick.
**Done when:** you can log out, wait, log in, and see correct Energy.

### Phase 2 — Roster & drills
Student generation, recruit pool, roster cap, drill assignment, curriculum
stages, XP, belts. Facility tuition collection with the 8-hour cap.
**Done when:** a student can be recruited, drilled from white belt to belt 2, and
tuition accrues and collects correctly.

### Phase 3 — Decay
Injury, recovery timers, loyalty decay including the high-performer rule,
permanent penalty on repeat injury.
**Done when:** neglecting the roster measurably degrades it over 48 real hours.

### Phase 4 — Scrolls & style
Drop tables, scroll sets, signature technique unlock, style vector accumulation,
crystallization flow and school naming.
**Done when:** two players drilling differently crystallize into different named
archetypes.

### Phase 5 — Challenges
Scouting, squad assignment with explicit slot ordering, resolution, battle
reports, poaching window, shields and guardrails, regional standing.
**Done when:** a scouted counter-composition reliably beats a stronger but
mismatched roster.

### Phase 6 — Lineage
Graduation ceremony, branch founding, style drift, tribute, patronage slots,
dormancy, defection, the lineage tree view.
**Done when:** the day-90 simulation shape reproduces in live data with a
time-accelerated test harness.

### Phase 7 — Tiers & world
Tier gates in the alternating breadth/depth pattern, region unlocks, established
schools as PvE opponents, weekly settlement.
**Done when:** a scripted player can climb Backyard → Regional on an accelerated
clock without a design dead-end.

---

## 7. TEST CASES TO WRITE FIRST

These encode the design's load-bearing claims. Write them before the features.

1. Energy regen across a simulated 10-hour offline gap lands exactly on cap, not
   over, and not lost to rounding.
2. Spending Energy at a partial tick does not discard the partial tick.
3. Roster cap cannot be exceeded by recruiting, poaching, or graduation reversal.
4. A challenge cannot target a dojo outside ±1 tier, or one under shield.
5. Squad slot ordering changes the outcome — same ten students, different order,
   different result.
6. A style-advantaged inferior roster beats a superior mismatched roster ~65% of
   the time over 1000 seeded runs.
7. A dojo cannot be poached from twice inside `POACH_WINDOW_HOURS`.
8. Loyalty decays faster for belt ≥ 3 than for belt < 3, all else equal.
9. Dormant branches produce exactly `DORMANT_TRIBUTE_RATE` of patronized tribute.
10. Pure-breadth patronage stalls before National Academy; pure-depth stalls
    before Regional Center. **Both must fail** — this is the design working.
11. All resolution is reproducible from `(seed, snapshot)`.
12. RLS blocks a player from mutating another player's dojo, students, or
    branches via direct API call.

---

## 8. FIRST CLAUDE CODE SESSION — SUGGESTED OPENING

> Read `DOJO_ASCENDANT_GDD.md` and `IMPLEMENTATION_SPEC.md`. Scaffold a Next.js
> App Router + TypeScript + Tailwind project wired to Supabase. Implement
> Phase 1 only: auth, player and dojo creation, region seed data, and lazy
> Energy/Focus regeneration computed from timestamps with no cron. Put every
> tuning value in `lib/constants.ts`. Write tests 1, 2 and 12 from the spec
> before the feature code. Stop at the end of Phase 1 and report.

Constrain the session to one phase. This design has enough interlocking systems
that a single unbounded session will produce something plausible and wrong.
