/**
 * Stops the integration suite truncating a database that is in use.
 *
 * The suite empties every table between tests. That is correct for a scratch
 * database and catastrophic for the one the application is serving from, and
 * the two are distinguished by nothing more than an environment variable.
 *
 * This module is the control. Pure functions, unit-tested, no I/O — so the
 * guard itself is verified by the fast suite that runs everywhere, rather than
 * only being exercised in the situation it exists to prevent.
 *
 * PARSING IS DELEGATED, DELIBERATELY
 *
 * The first version of this compared `new URL().hostname` and `.pathname`. That
 * left four ways to reach the same database while looking different: a trailing
 * dot on the host, an uppercase host, a percent-encoded database name, and
 * `?host=` — which node-postgres *prefers over the URL authority*, making the
 * hostname a naive check inspects purely decorative.
 *
 * So the target is resolved with `pg-connection-string`, the same parser `pg`
 * uses to decide where to connect. If the guard and the driver disagree about
 * what a string means, the guard is worthless; sharing the parser makes
 * disagreement impossible.
 */

import { parse } from 'pg-connection-string';

export type Target = { host: string; database: string };

/**
 * Reduce a connection string to the pair that identifies the database.
 *
 * Credentials, port and other parameters are deliberately ignored: two strings
 * differing only in password point at the same rows.
 */
export function parseTarget(url: string | undefined | null): Target | null {
  if (!url || typeof url !== 'string' || url.trim() === '') return null;

  // pg-connection-string accepts a bare word as a database name — `parse('not a
  // url')` yields `{ host: 'base', database: 'not a url' }` rather than
  // failing. Requiring the scheme first keeps a malformed value from resolving
  // to a plausible-looking target. lib/env.ts demands the same of DATABASE_URL.
  if (!/^postgres(?:ql)?:\/\//i.test(url.trim())) return null;

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(url);
  } catch {
    return null;
  }

  const rawHost = parsed.host;
  const rawDatabase = parsed.database;
  if (!rawHost || !rawDatabase) return null;

  // Neon exposes one database on two hostnames — the direct endpoint and the
  // PgBouncer pooler, differing only by a "-pooler" suffix on the first label.
  // Treating them as different databases is what let the suite truncate the
  // application's data through the other endpoint.
  const host = rawHost
    .replace(/^([^.]*?)-pooler\./, '$1.')
    // A trailing dot is the DNS root and addresses the identical host.
    .replace(/\.$/, '')
    .toLowerCase();

  return { host, database: rawDatabase.toLowerCase() };
}

/** True when two connection strings address the same database. */
export function isSameDatabase(a: string | undefined, b: string | undefined): boolean {
  const left = parseTarget(a);
  const right = parseTarget(b);
  if (!left || !right) return false;
  return left.host === right.host && left.database === right.database;
}

function refuse(lines: string[]): never {
  throw new Error(['Refusing to run the integration suite.', '', ...lines].join('\n'));
}

/**
 * Throw unless `testUrl` is safely distinct from every application database.
 *
 * Not overridable, and that is intentional. There is no legitimate reason to
 * run a suite that truncates tables against the database the application is
 * serving from; an escape hatch would only ever be used in the moment somebody
 * is in a hurry, which is exactly the moment this needs to hold.
 */
export function assertSafeTestTarget(testUrl: string, appUrls: (string | undefined)[]): void {
  const target = parseTarget(testUrl);

  // Fails CLOSED. "I could not understand this string" is not evidence that it
  // is safe, and the cost of being wrong here is deleted production data.
  if (!target) {
    refuse([
      'TEST_DATABASE_URL could not be parsed, so it cannot be shown to be safe.',
      '',
      'This suite TRUNCATES every table between tests, so an unrecognised target',
      'is refused rather than assumed harmless.',
    ]);
  }

  for (const appUrl of appUrls) {
    if (!appUrl || appUrl.trim() === '') continue; // genuinely not configured, e.g. CI

    const app = parseTarget(appUrl);
    if (!app) {
      refuse([
        'An application connection string could not be parsed, so TEST_DATABASE_URL',
        'cannot be shown to differ from it.',
        '',
        'Check DATABASE_URL and DATABASE_URL_UNPOOLED.',
      ]);
    }

    if (app.host === target.host && app.database === target.database) {
      refuse([
        'TEST_DATABASE_URL points at the same database as the application:',
        `  ${target.host}/${target.database}`,
        '',
        'This suite TRUNCATES every table between tests. Running it here would',
        'delete live players, dojos and region data.',
        '',
        'Use a throwaway Neon branch instead:',
        '  Neon dashboard -> Branches -> New branch -> copy its connection string',
        '',
        'Or unset TEST_DATABASE_URL entirely — the suite then runs against an',
        'in-process Postgres, which is what CI does and needs no credentials.',
      ]);
    }
  }
}
