/**
 * Seeds region reference data. SPEC §6 Phase 1 "region seed data".
 *
 * Idempotent by `regions.slug`: safe to run on every deploy, and editing a
 * region's numbers and re-running updates it in place rather than duplicating.
 *
 *   npm run db:seed
 */

import { sql } from 'drizzle-orm';

import { regions } from '@/lib/db/schema';
import { REGION_SEEDS } from '@/lib/db/seed/regions';

import { describeTarget, open } from './db';

async function main() {
  const { pool, db } = open('direct');
  console.log(`[seed] target ${describeTarget('direct')}`);

  try {
    const result = await db
      .insert(regions)
      .values(
        REGION_SEEDS.map((region) => ({
          slug: region.slug,
          name: region.name,
          description: region.description,
          recruitQuality: region.recruitQuality,
          scrollFamilies: region.scrollFamilies,
          characterVector: region.characterVector,
          unlockTier: region.unlockTier,
        })),
      )
      .onConflictDoUpdate({
        target: regions.slug,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          recruitQuality: sql`excluded.recruit_quality`,
          scrollFamilies: sql`excluded.scroll_families`,
          characterVector: sql`excluded.character_vector`,
          unlockTier: sql`excluded.unlock_tier`,
        },
      })
      .returning({ slug: regions.slug, unlockTier: regions.unlockTier });

    for (const region of result) {
      const gate =
        region.unlockTier === 0 ? 'available at Backyard' : `unlocks at tier ${region.unlockTier}`;
      console.log(`  ${region.slug.padEnd(20)} ${gate}`);
    }
    console.log(`[seed] ${result.length} regions up to date`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[seed] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
