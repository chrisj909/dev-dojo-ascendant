/**
 * Turns a Postgres write failure into something the UI can act on.
 *
 * WHY THIS IS NOT A REGEX OVER THE MESSAGE
 *
 * It was, and it caused a live redirect loop. `/players_user_id/` was written to
 * catch the unique constraint `players_user_id_unique`; it also matched the
 * foreign key `players_user_id_users_id_fk`. So when a session named a `users`
 * row that no longer existed, the resulting hard failure was reported as
 * "you already have a dojo" — which redirected to /dojo, which found no dojo and
 * redirected back to /create, blanking the form and explaining nothing.
 *
 * Constraint names share prefixes by construction: drizzle derives them from
 * table and column, so `<table>_<column>_unique` and
 * `<table>_<column>_<ref>_fk` always collide under substring matching. The
 * SQLSTATE is what actually distinguishes them, and it is exact.
 *
 * Anything not recognised returns `unknown`, which callers must surface rather
 * than dress up as a friendlier outcome. Guessing is what caused the loop.
 */

/** SQLSTATE codes, from the Postgres error index. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

export type WriteFailure =
  /** The chosen handle is already in use. */
  | 'handle_taken'
  /** This player already has the row being created. Safe to send them onward. */
  | 'already_exists'
  /**
   * The session names a row that no longer exists. The user is holding a valid
   * signed token for a deleted account — sessions are JWTs and outlive their
   * `users` row (docs/DECISIONS.md D6). The remedy is to sign in again; there is
   * nothing the user can do on the current page.
   */
  | 'stale_session'
  /** Not recognised. Callers must report it, not translate it. */
  | 'unknown';

/**
 * Constraint names, pinned to drizzle/0000_init.sql.
 *
 * Listed exhaustively rather than pattern-matched. If a migration renames one,
 * a unit test fails — which is the point, because the alternative is this
 * silently degrading to `unknown` in production.
 */
const UNIQUE_CONSTRAINTS: Record<string, WriteFailure> = {
  players_handle_unique: 'handle_taken',
  players_handle_lower_idx: 'handle_taken',
  players_user_id_unique: 'already_exists',
  dojos_player_id_unique: 'already_exists',
};

const FOREIGN_KEYS: Record<string, WriteFailure> = {
  // The identity the session asserts has been deleted.
  players_user_id_users_id_fk: 'stale_session',
  dojos_player_id_players_id_fk: 'stale_session',
  // A missing region is a bad request, NOT an expired identity. Conflating them
  // would ask the user to sign in again to fix something sign-in cannot fix.
  dojos_region_id_regions_id_fk: 'unknown',
};

type DriverError = { code?: unknown; constraint?: unknown };

/**
 * Walk the `cause` chain for the underlying driver error. Drizzle wraps the
 * driver error in its own, so `code` and `constraint` are never on the outermost
 * one. Bounded, and tolerant of a cyclic chain.
 */
function findDriverError(error: unknown): DriverError | null {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; current !== null && current !== undefined && depth < 12; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);

    if (typeof current === 'object') {
      const candidate = current as DriverError;
      if (typeof candidate.code === 'string') return candidate;
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return null;
}

/** Classify a failed write. Never throws. */
export function classifyWriteError(error: unknown): WriteFailure {
  const driver = findDriverError(error);
  if (!driver) return 'unknown';

  const code = typeof driver.code === 'string' ? driver.code : '';
  const constraint = typeof driver.constraint === 'string' ? driver.constraint : '';
  if (!constraint) return 'unknown';

  if (code === UNIQUE_VIOLATION) return UNIQUE_CONSTRAINTS[constraint] ?? 'unknown';
  if (code === FOREIGN_KEY_VIOLATION) return FOREIGN_KEYS[constraint] ?? 'unknown';

  return 'unknown';
}
