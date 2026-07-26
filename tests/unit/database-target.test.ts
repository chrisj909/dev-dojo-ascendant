/**
 * Guards the integration suite against truncating a database somebody is using.
 *
 * Written after the suite did exactly that. `TEST_DATABASE_URL` was pointed at
 * the application's own Neon database to verify the row-level security policies
 * against real Postgres; the harness truncates every table between tests, so it
 * emptied the regions table and every user row while the app was live. The
 * symptom reaching the player was "That region is not open to new dojos" —
 * nothing that pointed at the cause.
 *
 * A comment in .env.example already warned about this. A comment is not a
 * control, which is the entire point of this file.
 */

import { describe, expect, it } from 'vitest';

import { assertSafeTestTarget, isSameDatabase, parseTarget } from '@/tests/support/database-target';

const NEON_POOLED =
  'postgresql://neondb_owner:pw@ep-shiny-smoke-ax7o0tdh-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require';
const NEON_DIRECT =
  'postgresql://neondb_owner:pw@ep-shiny-smoke-ax7o0tdh.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require';
const NEON_BRANCH =
  'postgresql://neondb_owner:pw@ep-quiet-thunder-a1b2c3d4.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require';
const NEON_OTHER_DB =
  'postgresql://neondb_owner:pw@ep-shiny-smoke-ax7o0tdh.c-4.us-east-2.aws.neon.tech/neondb_test?sslmode=require';

/**
 * Four spellings that reach the identical host and database while looking
 * different to a naive comparison. Each was a live bypass of this guard, found
 * by adversarial review AFTER the guard shipped — the first version compared
 * `new URL().hostname` and `pathname` with only lowercasing and -pooler
 * stripping.
 */
const BYPASSES: Record<string, string> = {
  'trailing dot on the host':
    'postgresql://u:p@ep-shiny-smoke-ax7o0tdh.c-4.us-east-2.aws.neon.tech./neondb',
  'uppercase host': 'postgresql://u:p@EP-SHINY-SMOKE-AX7O0TDH.C-4.US-EAST-2.AWS.NEON.TECH/neondb',
  'real host hidden in ?host=':
    'postgresql://u:p@decoy.example.com/neondb?host=ep-shiny-smoke-ax7o0tdh.c-4.us-east-2.aws.neon.tech',
  'percent-encoded database name':
    'postgresql://u:p@ep-shiny-smoke-ax7o0tdh.c-4.us-east-2.aws.neon.tech/%6ee%6fndb',
};

describe('parseTarget', () => {
  it('reduces a connection string to the host and database that identify it', () => {
    expect(parseTarget(NEON_DIRECT)).toEqual({
      host: 'ep-shiny-smoke-ax7o0tdh.c-4.us-east-2.aws.neon.tech',
      database: 'neondb',
    });
  });

  it('strips the -pooler suffix, because both endpoints are one database', () => {
    // This is the whole trap. The pooled and direct endpoints have different
    // hostnames and identical contents, so a naive string comparison would
    // happily let the suite truncate the app database through the other door.
    expect(parseTarget(NEON_POOLED)).toEqual(parseTarget(NEON_DIRECT));
  });

  it('ignores credentials, port and query parameters', () => {
    const a = 'postgresql://alice:secret@db.example.com:5432/app?sslmode=require';
    const b = 'postgresql://bob:different@db.example.com/app';
    expect(parseTarget(a)).toEqual(parseTarget(b));
  });

  it('returns null for something that is not a connection string', () => {
    expect(parseTarget('')).toBeNull();
    expect(parseTarget('not a url')).toBeNull();
  });
});

describe('isSameDatabase', () => {
  it('matches the pooled and direct endpoints of one Neon database', () => {
    expect(isSameDatabase(NEON_POOLED, NEON_DIRECT)).toBe(true);
  });

  it('separates two branches of the same Neon project', () => {
    // Neon branches get distinct endpoint hostnames, so a genuine test branch
    // passes the guard without anyone having to configure an exemption.
    expect(isSameDatabase(NEON_DIRECT, NEON_BRANCH)).toBe(false);
  });

  it('separates two databases on the same host', () => {
    expect(isSameDatabase(NEON_DIRECT, NEON_OTHER_DB)).toBe(false);
  });

  it('is false when either side is unparseable rather than guessing', () => {
    expect(isSameDatabase(NEON_DIRECT, '')).toBe(false);
  });
});

describe('bypasses that reach the same database by another spelling', () => {
  for (const [label, url] of Object.entries(BYPASSES)) {
    it(`is not fooled by a ${label}`, () => {
      expect(isSameDatabase(url, NEON_DIRECT), label).toBe(true);
      expect(() => assertSafeTestTarget(url, [NEON_POOLED, NEON_DIRECT])).toThrow(/same database/i);
    });
  }

  it('resolves ?host= the way the driver does, not the way the URL reads', () => {
    // pg prefers the host query parameter over the URL authority, so the
    // hostname a naive check inspects is decorative.
    expect(parseTarget(BYPASSES['real host hidden in ?host='])?.host).toBe(
      'ep-shiny-smoke-ax7o0tdh.c-4.us-east-2.aws.neon.tech',
    );
  });
});

describe('unparseable input fails closed', () => {
  it('refuses rather than allowing when the test target cannot be parsed', () => {
    // Returning "not the same database" on a string nobody understands is the
    // wrong default for a guard whose failure mode is deleting live data.
    expect(() => assertSafeTestTarget('not a url', [NEON_DIRECT])).toThrow(/could not be parsed/i);
  });

  it('refuses when an application connection string cannot be parsed', () => {
    expect(() => assertSafeTestTarget(NEON_BRANCH, ['garbage://'])).toThrow(/could not be parsed/i);
  });

  it('still allows a clean target when no application database is configured', () => {
    expect(() => assertSafeTestTarget(NEON_BRANCH, [undefined, ''])).not.toThrow();
  });
});

describe('assertSafeTestTarget', () => {
  it('refuses a test target that is the application database', () => {
    expect(() => assertSafeTestTarget(NEON_DIRECT, [NEON_POOLED, NEON_DIRECT])).toThrow(
      /same database/i,
    );
  });

  it('refuses it through the pooled endpoint too', () => {
    // The exact mistake that caused this: DATABASE_URL was the pooled string,
    // TEST_DATABASE_URL the direct one, and they are one database.
    expect(() => assertSafeTestTarget(NEON_DIRECT, [NEON_POOLED, undefined])).toThrow(
      /same database/i,
    );
  });

  it('names the offending variable so the message is actionable', () => {
    expect(() => assertSafeTestTarget(NEON_DIRECT, [NEON_POOLED, NEON_DIRECT])).toThrow(
      /TEST_DATABASE_URL/,
    );
  });

  it('allows a separate Neon branch', () => {
    expect(() => assertSafeTestTarget(NEON_BRANCH, [NEON_POOLED, NEON_DIRECT])).not.toThrow();
  });

  it('allows a different database on the same host', () => {
    expect(() => assertSafeTestTarget(NEON_OTHER_DB, [NEON_POOLED, NEON_DIRECT])).not.toThrow();
  });

  it('allows anything when no application database is configured', () => {
    // CI has no DATABASE_URL. There is nothing to protect, so nothing to refuse.
    expect(() => assertSafeTestTarget(NEON_DIRECT, [undefined, undefined])).not.toThrow();
    expect(() => assertSafeTestTarget(NEON_DIRECT, [])).not.toThrow();
  });

  it('has no escape hatch', () => {
    // Deliberately not overridable. There is no legitimate reason to truncate
    // the database the application is serving from; the fix is always to point
    // TEST_DATABASE_URL somewhere else.
    expect(Object.keys(process.env).filter((k) => /ALLOW.*DESTRUCT/i.test(k))).toHaveLength(0);
  });
});
