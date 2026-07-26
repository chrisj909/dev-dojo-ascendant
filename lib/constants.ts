/**
 * DOJO ASCENDANT — TUNING CONSTANTS
 *
 * Single source of truth. See IMPLEMENTATION_SPEC.md §4.
 *
 * RULE: never inline a magic number anywhere else in the codebase. If a number
 * influences game feel, balance, or pacing, it belongs here. A `guard-constants`
 * hook (.claude/hooks/guard-constants.mjs) enforces this on every edit.
 *
 * Values marked PHASE-N are declared now for single-source-of-truth reasons but
 * are not consumed until that phase lands.
 */

// ---------------------------------------------------------------------------
// Resources — SPEC §4 "Resources", GDD §5
// ---------------------------------------------------------------------------

/** Milliseconds of elapsed time that yield one point of Energy. */
export const ENERGY_REGEN_MS = 6 * 60 * 1000; // 1 per 6 min

/** Energy cap before the headmaster's Stamina attribute is added. */
export const ENERGY_CAP_BASE = 50;

/** Milliseconds of elapsed time that yield one point of Focus. */
export const FOCUS_REGEN_MS = 60 * 60 * 1000; // 1 per hour

/** Focus cap before the Stamina bonus is added. */
export const FOCUS_CAP_BASE = 5;

/** Stamina is divided by this to produce the bonus Focus cap. */
export const FOCUS_CAP_STAMINA_DIVISOR = 10;

/** Uncollected facility tuition stops accruing after this many hours. GDD §12. */
export const TUITION_CAP_HOURS = 8;

/** Energy a brand new dojo opens with. */
export const STARTING_ENERGY = 10;

/** Focus a brand new dojo opens with. */
export const STARTING_FOCUS = 2;

/**
 * Tuition a brand new dojo opens with. SPEC §3: `tuition bigint default 0`.
 *
 * This shipped as 500 — invented during the Phase 1 build and never recorded as
 * a deviation. CLAUDE.md says the spec wins on numbers, and docs/DECISIONS.md D5
 * enumerates the sanctioned schema deviations without this one, so it follows
 * the spec.
 *
 * Whether a dojo can afford its first recruit on nothing is a real question
 * (GDD §4.3 makes recruiting cost tuition, §12 makes facilities generate it),
 * but it is a Phase 2 balance question to answer with a simulation rather than
 * a number quietly left in place. Tracked as `starting-economy-bootstrap`.
 *
 * NOTE: this value is baked into the column DEFAULT by drizzle/0000_init.sql.
 * Changing it here does nothing to an existing database without a migration —
 * hence drizzle/0003, and the assertion in tests/integration/onboarding.test.ts
 * that the stored default matches this constant.
 */
export const STARTING_TUITION = 0;

// ---------------------------------------------------------------------------
// Headmaster attributes — GDD §3
// ---------------------------------------------------------------------------

/** Every headmaster attribute starts here. SPEC §3 `players`. */
export const HEADMASTER_ATTRIBUTE_START = 5;

/** Lowest legal value for a headmaster attribute. */
export const HEADMASTER_ATTRIBUTE_MIN = 1;

/** Highest legal value for a headmaster attribute. */
export const HEADMASTER_ATTRIBUTE_MAX = 100;

/** Nationalities a player may pick at creation. Sets starting scroll lineage. */
export const NATIONALITIES = [
  'Japanese',
  'Chinese',
  'Korean',
  'Thai',
  'Brazilian',
  'Russian',
  'Filipino',
  'Indian',
] as const;

export type Nationality = (typeof NATIONALITIES)[number];

/** Handle / name validation bounds, used by creation forms and server actions. */
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 20;
export const HANDLE_PATTERN = /^[a-z0-9_]+$/;
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 40;

/** Email used by the local development sign-in provider. Never used in production. */
export const DEV_LOGIN_EMAIL = 'dev@localhost';

// ---------------------------------------------------------------------------
// Dojo tiers — GDD §10
// ---------------------------------------------------------------------------

export const TIER_NAMES = [
  'Backyard',
  'Local School',
  'Regional Center',
  'National Academy',
  'International Institute',
] as const;

export type TierName = (typeof TIER_NAMES)[number];

/** Lowest and highest tier index. Tier is stored as an int 0..4. */
export const TIER_MIN = 0;
export const TIER_MAX = TIER_NAMES.length - 1;

// ---------------------------------------------------------------------------
// Drills — SPEC §4 "Drills", GDD §6. PHASE-2.
// ---------------------------------------------------------------------------

export const DRILL_COST = { foundation: 1, form: 2, application: 3 } as const;

/** Base attribute XP per drill, scaled by (1 + technique / DRILL_XP_TECHNIQUE_DIVISOR). */
export const DRILL_XP_BASE = 10;
export const DRILL_XP_TECHNIQUE_DIVISOR = 20;

export const CURRICULUM_LENGTH = {
  foundation: 12,
  form: 18,
  application: 24,
} as const;

/** Payout multiplier when re-running an already completed curriculum. GDD §6.1. */
export const REPEAT_PAYOUT_RATE = 0.35;

export const SCROLL_DROP_RATE = {
  foundation: 0.02,
  form: 0.05,
  application: 0.09,
} as const;

/** Scrolls required to complete a lineage set and unlock a signature technique. */
export const SCROLL_SET_SIZE = 6;

// ---------------------------------------------------------------------------
// Injury / loyalty — SPEC §4, GDD §11. PHASE-3.
// ---------------------------------------------------------------------------

export const INJURY_CHANCE_APPLICATION = 0.06;
export const INJURY_DISCIPLINE_DIVISOR = 25;
export const INJURY_RECOVERY_HOURS = 18;
export const PERMANENT_PENALTY_AT_INJURIES = 3;

export const LOYALTY_DECAY_PER_DAY = 2;
export const LOYALTY_DECAY_MENTAL_DIVISOR = 30;
/** Belt >= LOYALTY_HIGH_PERFORMER_BELT decays at this rate instead. GDD §11. */
export const LOYALTY_DECAY_HIGH_PERFORMER = 3.5;
export const LOYALTY_HIGH_PERFORMER_BELT = 3;
export const LOYALTY_LOSS_ON_DEFEAT = 8;
export const LOYALTY_MIN = 0;
export const LOYALTY_MAX = 100;
export const LOYALTY_START = 70;

// ---------------------------------------------------------------------------
// Roster — GDD §4.1. PHASE-2.
// ---------------------------------------------------------------------------

/** Hard roster cap, indexed by dojo tier. */
export const ROSTER_CAP_BY_TIER = [8, 9, 10, 11, 12] as const;

// ---------------------------------------------------------------------------
// Challenges — SPEC §4, GDD §8. PHASE-5.
// ---------------------------------------------------------------------------

export const CHALLENGE_FOCUS_COST = 2;
export const SCOUT_FOCUS_COST = 1;
export const CHALLENGE_SQUAD_SIZE = 5;
/** A challenge may only target a dojo within +/- this many tiers. */
export const TIER_RANGE = 1;
export const MATCHUP_MULTIPLIER = 1.45;
export const WEAPONS_BONUS = 1.25;
export const WEAPONS_FRAGILITY = 0.7;
export const CHALLENGE_POWER_JITTER = 0.12;
export const POACH_WINDOW_HOURS = 24;
/** Students at or below this belt cannot be poached. */
export const POACH_IMMUNE_BELT = 1;
export const NEW_PLAYER_SHIELD_DAYS = 7;

/** Weights in power(s). SPEC §5.1. */
export const POWER_WEIGHTS = {
  strength: 0.9,
  speed: 0.8,
  technique: 1.1,
  stamina: 0.7,
  mental: 0.6,
} as const;

export const POWER_LOYALTY_BASE = 0.85;
export const POWER_LOYALTY_DIVISOR = 200;

// ---------------------------------------------------------------------------
// Lineage — SPEC §4, GDD §9. PHASE-6.
// ---------------------------------------------------------------------------

export const PATRONAGE_SLOTS_BY_TIER = [3, 4, 5, 6, 7] as const;
export const BRANCH_GRADUATION_DAYS = 28;
export const BRANCH_TIER_UP_GRADUATES = 3;
export const DORMANT_TRIBUTE_RATE = 0.25;
export const DORMANT_ATTRITION_PER_DAY = 0.004;
export const DORMANT_LOYALTY_DECAY_PER_DAY = 0.5;
export const STYLE_DRIFT_SIGMA = 0.08;
export const REGION_PULL = 0.15;

// ---------------------------------------------------------------------------
// Style — SPEC §4, GDD §7. PHASE-4.
// ---------------------------------------------------------------------------

export const CRYSTALLIZE_THRESHOLD = 400;
export const RECRYSTALLIZE_COST_TUITION = 25000;

export const STYLE_CATEGORIES = ['striking', 'grappling', 'internal', 'weapons'] as const;

export const STYLE_SUB_AXES = ['aggression', 'patience', 'precision', 'power'] as const;

export type StyleCategory = (typeof STYLE_CATEGORIES)[number];
export type StyleSubAxis = (typeof STYLE_SUB_AXES)[number];

/** A zeroed style vector. Every new dojo starts here. SPEC §5.2. */
export const EMPTY_STYLE_VECTOR = {
  striking: 0,
  grappling: 0,
  internal: 0,
  weapons: 0,
  aggression: 0,
  patience: 0,
  precision: 0,
  power: 0,
} as const;

// ---------------------------------------------------------------------------
// Time helpers — derived, not independently tunable.
// ---------------------------------------------------------------------------

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
