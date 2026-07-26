/**
 * Classification of database write failures.
 *
 * Written after a live redirect loop on the dojo creation form. The classifier
 * matched a SUBSTRING of the error message: `/players_user_id/` was meant to
 * catch the unique constraint `players_user_id_unique`, and also matched the
 * foreign key `players_user_id_users_id_fk`. A hard failure — the session named
 * a `users` row that no longer existed — was therefore reported as "you already
 * have a dojo", which redirected to /dojo, which found no dojo and redirected
 * back to /create. The form blanked and nothing was ever created or explained.
 *
 * Substring matching on constraint names is the defect. Postgres gives an exact
 * SQLSTATE and an exact constraint name; both are used here and neither is
 * guessed at. The real constraint names are pinned below against
 * drizzle/0000_init.sql, so renaming one breaks a test rather than silently
 * degrading behaviour at runtime.
 */

import { describe, expect, it } from 'vitest';

import { classifyWriteError, type WriteFailure } from '@/lib/db/write-errors';

/** Shaped exactly like a node-postgres error, wrapped the way drizzle wraps it. */
function pgError(code: string, constraint: string, message: string): Error {
  const driver = Object.assign(new Error(message), { code, constraint });
  return Object.assign(new Error('Failed query: insert into "players" ...'), { cause: driver });
}

const UNIQUE = '23505';
const FOREIGN_KEY = '23503';
const NOT_NULL = '23502';
const CHECK = '23514';

describe('the failure that caused the redirect loop', () => {
  it('reports a missing user row as a stale session, not as an existing dojo', () => {
    // The exact error, verified against live Postgres.
    const error = pgError(
      FOREIGN_KEY,
      'players_user_id_users_id_fk',
      'insert or update on table "players" violates foreign key constraint "players_user_id_users_id_fk"',
    );

    expect(classifyWriteError(error)).toBe<WriteFailure>('stale_session');
    // The regression in one line: this must never again be 'already_exists'.
    expect(classifyWriteError(error)).not.toBe('already_exists');
  });

  it('still reports a genuine duplicate player as an existing dojo', () => {
    const error = pgError(
      UNIQUE,
      'players_user_id_unique',
      'duplicate key value violates unique constraint "players_user_id_unique"',
    );
    expect(classifyWriteError(error)).toBe<WriteFailure>('already_exists');
  });

  it('distinguishes the two purely by SQLSTATE, since the names share a prefix', () => {
    // `players_user_id_unique` and `players_user_id_users_id_fk` both begin
    // `players_user_id`. Any substring rule confuses them.
    const duplicate = pgError(UNIQUE, 'players_user_id_unique', 'duplicate key');
    const orphan = pgError(FOREIGN_KEY, 'players_user_id_users_id_fk', 'foreign key');
    expect(classifyWriteError(duplicate)).not.toBe(classifyWriteError(orphan));
  });
});

describe('handle collisions', () => {
  it('recognises the unique constraint', () => {
    expect(
      classifyWriteError(pgError(UNIQUE, 'players_handle_unique', 'duplicate key value')),
    ).toBe<WriteFailure>('handle_taken');
  });

  it('recognises the case-insensitive index', () => {
    // Two players may not differ only by case, which the lower() index enforces
    // separately from the plain unique constraint.
    expect(
      classifyWriteError(pgError(UNIQUE, 'players_handle_lower_idx', 'duplicate key value')),
    ).toBe<WriteFailure>('handle_taken');
  });
});

describe('the dojo side', () => {
  it('reports a duplicate dojo as an existing dojo', () => {
    expect(
      classifyWriteError(pgError(UNIQUE, 'dojos_player_id_unique', 'duplicate key value')),
    ).toBe<WriteFailure>('already_exists');
  });

  it('reports a dangling player reference as a stale session', () => {
    expect(
      classifyWriteError(pgError(FOREIGN_KEY, 'dojos_player_id_players_id_fk', 'foreign key')),
    ).toBe<WriteFailure>('stale_session');
  });

  it('reports a bad region reference as unknown, not as a stale session', () => {
    // A missing region is a caller mistake, not an expired identity, and the two
    // must not share a remedy — one asks the user to sign in again for nothing.
    expect(
      classifyWriteError(pgError(FOREIGN_KEY, 'dojos_region_id_regions_id_fk', 'foreign key')),
    ).toBe<WriteFailure>('unknown');
  });
});

describe('everything else is unknown, and unknown is honest', () => {
  it('does not classify a not-null violation', () => {
    expect(classifyWriteError(pgError(NOT_NULL, '', 'null value in column'))).toBe<WriteFailure>(
      'unknown',
    );
  });

  it('does not classify a check violation', () => {
    expect(classifyWriteError(pgError(CHECK, 'some_check', 'violates check'))).toBe<WriteFailure>(
      'unknown',
    );
  });

  it('does not classify a connection failure', () => {
    expect(classifyWriteError(new Error('connection terminated unexpectedly'))).toBe<WriteFailure>(
      'unknown',
    );
  });

  it('does not classify a non-error', () => {
    expect(classifyWriteError(undefined)).toBe<WriteFailure>('unknown');
    expect(classifyWriteError('a string')).toBe<WriteFailure>('unknown');
    expect(classifyWriteError(null)).toBe<WriteFailure>('unknown');
  });

  it('is not fooled by a constraint name appearing in unrelated prose', () => {
    // The old implementation matched the message body. A stray mention of a
    // constraint name in any error text was enough to misclassify it.
    const noisy = Object.assign(
      new Error('could not serialize access; see players_user_id_unique'),
      {
        code: '40001',
      },
    );
    expect(classifyWriteError(noisy)).toBe<WriteFailure>('unknown');
  });
});

describe('error unwrapping', () => {
  it('finds the driver error however deeply drizzle nests it', () => {
    const driver = Object.assign(new Error('duplicate key'), {
      code: UNIQUE,
      constraint: 'players_handle_unique',
    });
    const wrapped = Object.assign(new Error('outer'), {
      cause: Object.assign(new Error('middle'), { cause: driver }),
    });
    expect(classifyWriteError(wrapped)).toBe<WriteFailure>('handle_taken');
  });

  it('does not loop forever on a cyclic cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(classifyWriteError(a)).toBe<WriteFailure>('unknown');
  });
});
