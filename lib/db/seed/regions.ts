/**
 * Region seed data. GDD §13.
 *
 * This is CONTENT, not tuning. Numbers that shape game feel live in
 * lib/constants.ts; these values describe what the world contains. The
 * guard-constants hook exempts this directory for that reason.
 *
 * Regions differ along two axes that matter mechanically:
 *
 *   recruitQuality   how good the recruit pool is (GDD §4.3)
 *   scrollFamilies   which lineage sets drop here, so completing a set you
 *                    cannot finish at home is what motivates expansion
 *                    (GDD §7.1)
 *
 * `characterVector` pulls the style of any branch founded here toward the
 * region's own character (SPEC §5.3), which is where emergent world flavour
 * comes from at zero content cost.
 */

import type { StyleVector } from '@/lib/game/style';

export type RegionSeed = {
  slug: string;
  name: string;
  description: string;
  recruitQuality: number;
  scrollFamilies: string[];
  characterVector: StyleVector;
  /** Lowest dojo tier permitted to found here. 0 is available from day one. */
  unlockTier: number;
};

/** The six lineage families. Six scrolls complete a set. GDD §7.1. */
export const SCROLL_FAMILIES = [
  'iron_fist',
  'flowing_river',
  'earth_root',
  'crescent_steel',
  'shattered_mirror',
  'silent_crane',
] as const;

export const REGION_SEEDS: RegionSeed[] = [
  {
    slug: 'okinawa-coast',
    name: 'Okinawa Coast',
    description:
      'Salt air and old karate. Schools here have been arguing about the same three kata for two hundred years, and every one of them is right.',
    recruitQuality: 2,
    scrollFamilies: ['iron_fist', 'silent_crane'],
    characterVector: {
      striking: 0.55,
      grappling: 0.1,
      internal: 0.25,
      weapons: 0.1,
      aggression: 0.3,
      patience: 0.5,
      precision: 0.45,
      power: 0.25,
    },
    unlockTier: 0,
  },
  {
    slug: 'henan-highlands',
    name: 'Henan Highlands',
    description:
      'Mist, stone steps, and internal work that takes a decade to show. Patient masters, impatient students, and a long memory for slights.',
    recruitQuality: 3,
    scrollFamilies: ['flowing_river', 'silent_crane'],
    characterVector: {
      striking: 0.2,
      grappling: 0.15,
      internal: 0.6,
      weapons: 0.05,
      aggression: 0.15,
      patience: 0.65,
      precision: 0.4,
      power: 0.15,
    },
    unlockTier: 0,
  },
  {
    slug: 'rio-favelas',
    name: 'Rio Favelas',
    description:
      'Ground game, all day, on concrete. Reputation is currency and everybody has already watched you roll.',
    recruitQuality: 3,
    scrollFamilies: ['earth_root', 'iron_fist'],
    characterVector: {
      striking: 0.2,
      grappling: 0.65,
      internal: 0.05,
      weapons: 0.1,
      aggression: 0.55,
      patience: 0.35,
      precision: 0.3,
      power: 0.4,
    },
    unlockTier: 0,
  },
  {
    slug: 'bangkok-riverside',
    name: 'Bangkok Riverside',
    description:
      'Stadium country. Clinch work and shin conditioning, fighters made early and spent early. The gyms take a cut of everything.',
    recruitQuality: 4,
    scrollFamilies: ['iron_fist', 'earth_root'],
    characterVector: {
      striking: 0.65,
      grappling: 0.2,
      internal: 0.05,
      weapons: 0.1,
      aggression: 0.7,
      patience: 0.15,
      precision: 0.3,
      power: 0.6,
    },
    unlockTier: 1,
  },
  {
    slug: 'kyoto-foothills',
    name: 'Kyoto Foothills',
    description:
      'Weapon lineages that never adapted and never had to. Precise, brittle, and deeply unimpressed by whatever you have been teaching.',
    recruitQuality: 4,
    scrollFamilies: ['crescent_steel', 'shattered_mirror'],
    characterVector: {
      striking: 0.15,
      grappling: 0.05,
      internal: 0.2,
      weapons: 0.6,
      aggression: 0.35,
      patience: 0.55,
      precision: 0.7,
      power: 0.25,
    },
    unlockTier: 2,
  },
  {
    slug: 'ural-steppe',
    name: 'Ural Steppe',
    description:
      'Cold, unfashionable, and enormously strong. Systems built by people who had to win fights outdoors in winter.',
    recruitQuality: 5,
    scrollFamilies: ['earth_root', 'crescent_steel', 'shattered_mirror'],
    characterVector: {
      striking: 0.3,
      grappling: 0.45,
      internal: 0.1,
      weapons: 0.15,
      aggression: 0.5,
      patience: 0.3,
      precision: 0.25,
      power: 0.7,
    },
    unlockTier: 3,
  },
];

/** Regions a brand new dojo may be founded in. */
export function startingRegions(): RegionSeed[] {
  return REGION_SEEDS.filter((region) => region.unlockTier === 0);
}
