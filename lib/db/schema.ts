/**
 * Postgres schema — SPEC §3.
 *
 * snake_case in the database, camelCase in TypeScript. Every table carries a
 * uuid primary key and `created_at`.
 *
 * Phase 1 only reads and writes `regions`, `players` and `dojos`. The remaining
 * tables are declared here because SPEC §7 test 12 requires row-level security
 * on students and branches to be demonstrably in force, and a policy cannot be
 * tested against a table that does not exist. No game logic touches them yet.
 *
 * Documented deviations from SPEC §3, all deliberate:
 *
 *   - Auth is Auth.js on Neon rather than Supabase, so `players.user_id`
 *     references the local `users` table instead of `auth.users`.
 *   - `dojos.player_id` is UNIQUE. MVP is one dojo per player, and making that
 *     a database constraint removes a whole class of duplicate-creation bug.
 *   - `branches.root_dojo_id` is new and denormalised. Ownership of a
 *     fourth-generation branch is otherwise a recursive walk, which an RLS
 *     policy cannot express without a recursive CTE on every row read.
 *   - `regions.slug` is new, so seeding is idempotent by natural key.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  EMPTY_STYLE_VECTOR,
  HEADMASTER_ATTRIBUTE_START,
  LOYALTY_START,
  STARTING_TUITION,
} from '@/lib/constants';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Auth.js tables. Written by @auth/drizzle-adapter on the owner connection.
// These deliberately carry no RLS: the adapter runs outside the per-player
// transaction context and would deadlock against a policy it cannot satisfy.
// They are also revoked from `app_user` entirely (see the RLS migration), so
// request-scoped code cannot read them at all.
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }),
  image: text('image'),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

// ---------------------------------------------------------------------------
// World. Read by everyone, written by nobody at runtime. GDD §13.
// ---------------------------------------------------------------------------

export const regions = pgTable('regions', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stable natural key so `npm run db:seed` is idempotent. */
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  /** Flavour shown on the region picker. */
  description: text('description').notNull().default(''),
  /** Drives recruit pool quality. GDD §4.3. */
  recruitQuality: integer('recruit_quality').notNull(),
  /** Which scroll families drop here. GDD §7.1. */
  scrollFamilies: text('scroll_families').array().notNull(),
  /** Pulls branch style drift toward the region's character. SPEC §5.3. */
  characterVector: jsonb('character_vector').notNull(),
  /** Lowest dojo tier that may found here. 0 means available from day one. */
  unlockTier: integer('unlock_tier').notNull().default(0),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Player-owned. Every table below is under RLS.
// ---------------------------------------------------------------------------

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    handle: text('handle').notNull().unique(),
    headmasterName: text('headmaster_name').notNull(),
    nationality: text('nationality').notNull(),

    // Teaching multipliers. GDD §3.
    technique: integer('technique').notNull().default(HEADMASTER_ATTRIBUTE_START),
    mental: integer('mental').notNull().default(HEADMASTER_ATTRIBUTE_START),
    presence: integer('presence').notNull().default(HEADMASTER_ATTRIBUTE_START),
    stamina: integer('stamina').notNull().default(HEADMASTER_ATTRIBUTE_START),
    discipline: integer('discipline').notNull().default(HEADMASTER_ATTRIBUTE_START),

    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('players_handle_lower_idx').on(sql`lower(${table.handle})`)],
);

export const dojos = pgTable(
  'dojos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** One dojo per player at MVP — enforced here rather than in application code. */
    playerId: uuid('player_id')
      .notNull()
      .unique()
      .references(() => players.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tier: integer('tier').notNull().default(0),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id),
    tuition: bigint('tuition', { mode: 'number' }).notNull().default(STARTING_TUITION),

    // Lazy-regenerated resources. SPEC §2.1. The value is only correct as of
    // its paired timestamp; never read one without the other.
    energy: integer('energy').notNull(),
    energyUpdatedAt: timestamp('energy_updated_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    focus: integer('focus').notNull(),
    focusUpdatedAt: timestamp('focus_updated_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),

    styleVector: jsonb('style_vector').notNull().default(EMPTY_STYLE_VECTOR),
    styleCrystallized: boolean('style_crystallized').notNull().default(false),
    styleName: text('style_name'),
    reputation: integer('reputation').notNull().default(0),
    /** New player protection. GDD §8.4. */
    shieldUntil: timestamp('shield_until', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [index('dojos_region_idx').on(table.regionId)],
);

export const students = pgTable(
  'students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dojoId: uuid('dojo_id')
      .notNull()
      .references(() => dojos.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),

    strength: integer('strength').notNull(),
    speed: integer('speed').notNull(),
    technique: integer('technique').notNull(),
    stamina: integer('stamina').notNull(),
    mental: integer('mental').notNull(),

    aptStriking: integer('apt_striking').notNull(),
    aptGrappling: integer('apt_grappling').notNull(),
    aptInternal: integer('apt_internal').notNull(),
    aptWeapons: integer('apt_weapons').notNull(),

    temperament: text('temperament').notNull(),
    background: text('background').notNull().default(''),

    belt: integer('belt').notNull().default(0),
    /** 0 foundation, 1 form, 2 application. GDD §6.1. */
    curriculumStage: integer('curriculum_stage').notNull().default(0),
    curriculumProgress: integer('curriculum_progress').notNull().default(0),

    loyalty: integer('loyalty').notNull().default(LOYALTY_START),
    /** healthy | strained | injured. GDD §11. */
    condition: text('condition').notNull().default('healthy'),
    recoversAt: timestamp('recovers_at', { withTimezone: true, mode: 'date' }),
    injuryCount: integer('injury_count').notNull().default(0),
    poachableUntil: timestamp('poachable_until', { withTimezone: true, mode: 'date' }),
    isGraduated: boolean('is_graduated').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index('students_dojo_idx').on(table.dojoId)],
);

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * The dojo at the root of this branch's lineage. Denormalised so an RLS
     * policy can answer "does the caller own this branch" without recursing up
     * `parent_branch_id` on every row.
     */
    rootDojoId: uuid('root_dojo_id')
      .notNull()
      .references(() => dojos.id, { onDelete: 'cascade' }),
    /** Set when the parent is the player's own dojo, null when it is a branch. */
    parentDojoId: uuid('parent_dojo_id').references(() => dojos.id, { onDelete: 'cascade' }),
    parentBranchId: uuid('parent_branch_id'),

    founderName: text('founder_name').notNull(),
    generation: integer('generation').notNull(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id),
    tier: integer('tier').notNull().default(0),
    ownGraduates: integer('own_graduates').notNull().default(0),
    styleVector: jsonb('style_vector').notNull(),
    patronized: boolean('patronized').notNull().default(false),
    loyalty: doublePrecision('loyalty').notNull().default(LOYALTY_START),
    foundedAt: timestamp('founded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastGraduationAt: timestamp('last_graduation_at', { withTimezone: true, mode: 'date' }),
    /** active | dormant | defected. GDD §9.4. */
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (table) => [
    // Self-reference: a branch founded by another branch. Declared here rather
    // than inline because drizzle cannot reference a table from inside its own
    // column definitions.
    foreignKey({
      name: 'branches_parent_branch_id_fk',
      columns: [table.parentBranchId],
      foreignColumns: [table.id],
    }).onDelete('cascade'),
    index('branches_root_idx').on(table.rootDojoId),
    index('branches_region_idx').on(table.regionId),
    index('branches_parent_branch_idx').on(table.parentBranchId),
  ],
);

export const scrolls = pgTable(
  'scrolls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dojoId: uuid('dojo_id')
      .notNull()
      .references(() => dojos.id, { onDelete: 'cascade' }),
    family: text('family').notNull(),
    /** Position within the six-scroll set. GDD §7.1. */
    index: integer('index').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('scrolls_dojo_family_index_idx').on(table.dojoId, table.family, table.index),
  ],
);

export const techniques = pgTable(
  'techniques',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dojoId: uuid('dojo_id')
      .notNull()
      .references(() => dojos.id, { onDelete: 'cascade' }),
    family: text('family').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('techniques_dojo_family_idx').on(table.dojoId, table.family)],
);

export const facilities = pgTable(
  'facilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dojoId: uuid('dojo_id')
      .notNull()
      .references(() => dojos.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    level: integer('level').notNull().default(1),
    /** Tuition accrues from here, capped at TUITION_CAP_HOURS. GDD §12. */
    collectedAt: timestamp('collected_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('facilities_dojo_kind_idx').on(table.dojoId, table.kind)],
);

export const challenges = pgTable(
  'challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attackerDojoId: uuid('attacker_dojo_id')
      .notNull()
      .references(() => dojos.id, { onDelete: 'cascade' }),
    defenderDojoId: uuid('defender_dojo_id')
      .notNull()
      .references(() => dojos.id, { onDelete: 'cascade' }),
    /** Server-seeded RNG. Reports regenerate from (seed, snapshot). SPEC §2.3. */
    seed: bigint('seed', { mode: 'bigint' }).notNull(),
    attackerSnapshot: jsonb('attacker_snapshot').notNull(),
    defenderSnapshot: jsonb('defender_snapshot').notNull(),
    /** attacker_win | defender_win. */
    result: text('result').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    index('challenges_attacker_idx').on(table.attackerDojoId),
    index('challenges_defender_idx').on(table.defenderDojoId),
  ],
);

export const drillLog = pgTable(
  'drill_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    /** Denormalised so RLS on the log does not have to join through students. */
    dojoId: uuid('dojo_id')
      .notNull()
      .references(() => dojos.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    loggedAt: timestamp('logged_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [index('drill_log_dojo_idx').on(table.dojoId)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const playersRelations = relations(players, ({ one }) => ({
  user: one(users, { fields: [players.userId], references: [users.id] }),
  dojo: one(dojos, { fields: [players.id], references: [dojos.playerId] }),
}));

export const dojosRelations = relations(dojos, ({ one, many }) => ({
  player: one(players, { fields: [dojos.playerId], references: [players.id] }),
  region: one(regions, { fields: [dojos.regionId], references: [regions.id] }),
  students: many(students),
  branches: many(branches),
  facilities: many(facilities),
  scrolls: many(scrolls),
  techniques: many(techniques),
}));

export const studentsRelations = relations(students, ({ one }) => ({
  dojo: one(dojos, { fields: [students.dojoId], references: [dojos.id] }),
}));

export const branchesRelations = relations(branches, ({ one }) => ({
  rootDojo: one(dojos, { fields: [branches.rootDojoId], references: [dojos.id] }),
  region: one(regions, { fields: [branches.regionId], references: [regions.id] }),
}));

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type Region = typeof regions.$inferSelect;
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Dojo = typeof dojos.$inferSelect;
export type NewDojo = typeof dojos.$inferInsert;
export type Student = typeof students.$inferSelect;
export type Branch = typeof branches.$inferSelect;

/** Every table that carries a row-level security policy. */
export const RLS_TABLES = [
  'players',
  'dojos',
  'students',
  'branches',
  'scrolls',
  'techniques',
  'facilities',
  'challenges',
  'drill_log',
  'regions',
] as const;

/** Tables the request-scoped `app_user` role must never be able to reach. */
export const AUTH_TABLES = ['users', 'accounts', 'sessions', 'verification_tokens'] as const;
