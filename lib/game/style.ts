/**
 * The school style vector. SPEC §5.2, GDD §7.2.
 *
 * Phase 1 only needs the type and a zero value — a new dojo is created with an
 * empty vector, and regions carry a character vector that pulls branch drift.
 * Accumulation, classification and crystallisation land in Phase 4.
 */

import { EMPTY_STYLE_VECTOR, STYLE_CATEGORIES, type StyleCategory } from '@/lib/constants';

export type StyleVector = {
  striking: number;
  grappling: number;
  internal: number;
  weapons: number;
  aggression: number;
  patience: number;
  precision: number;
  power: number;
};

/** A fresh, unweighted vector. Never share the constant itself — it is frozen. */
export function emptyStyleVector(): StyleVector {
  return { ...EMPTY_STYLE_VECTOR };
}

/**
 * Total weight accumulated so far. Crystallisation fires when this crosses
 * CRYSTALLIZE_THRESHOLD (Phase 4), and it is only the four categories that
 * count — the sub-axes describe how, not how much.
 */
export function totalWeight(vector: StyleVector): number {
  return STYLE_CATEGORIES.reduce((sum, key) => sum + vector[key], 0);
}

/**
 * The category a dojo currently reads as, used for PvP matchups (GDD §8.2).
 * Returns null while every category is still zero — an unformed school has no
 * scoutable identity yet, and callers must handle that rather than defaulting
 * to striking.
 */
export function dominantCategory(vector: StyleVector): StyleCategory | null {
  let best: StyleCategory | null = null;
  let bestValue = 0;
  for (const key of STYLE_CATEGORIES) {
    if (vector[key] > bestValue) {
      bestValue = vector[key];
      best = key;
    }
  }
  return best;
}

/** Narrow an untrusted jsonb payload back into a StyleVector. */
export function parseStyleVector(value: unknown): StyleVector {
  if (typeof value !== 'object' || value === null) return emptyStyleVector();
  const source = value as Record<string, unknown>;
  const result = emptyStyleVector();
  for (const key of Object.keys(result) as (keyof StyleVector)[]) {
    const raw = source[key];
    result[key] = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  }
  return result;
}
