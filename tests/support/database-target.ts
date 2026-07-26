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
 */

export type Target = { host: string; database: string };

/**
 * Reduce a connection string to the pair that identifies the database.
 *
 * Credentials, port and query parameters are deliberately ignored: two strings
 * differing only in password point at the same rows.
 */
export function parseTarget(url: string | undefined | null): Target | null {
  if (!url || typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.hostname) return null;

  // Neon exposes one database on two hostnames — the direct endpoint and the
  // PgBouncer pooler, which differ only by a "-pooler" suffix on the first
  // label. Treating them as different databases is precisely the hole that let
  // the suite truncate the application's data through the other endpoint.
  const host = parsed.hostname.replace(/^([^.]*?)-pooler\./, '$1.');
  const database = parsed.pathname.replace(/^\//, '');
  if (!database) return null;

  return { host: host.toLowerCase(), database: database.toLowerCase() };
}

/** True when two connection strings address the same database. */
export function isSameDatabase(a: string | undefined, b: string | undefined): boolean {
  const left = parseTarget(a);
  const right = parseTarget(b);
  if (!left || !right) return false;
  return left.host === right.host && left.database === right.database;
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
  const clash = appUrls.find((appUrl) => isSameDatabase(testUrl, appUrl));
  if (!clash) return;

  const target = parseTarget(testUrl);
  throw new Error(
    [
      'Refusing to run the integration suite.',
      '',
      `TEST_DATABASE_URL points at the same database as the application:`,
      `  ${target?.host}/${target?.database}`,
      '',
      'This suite TRUNCATES every table between tests. Running it here would',
      'delete live players, dojos and region data.',
      '',
      'Use a throwaway Neon branch instead:',
      '  Neon dashboard -> Branches -> New branch -> copy its connection string',
      '',
      'Or unset TEST_DATABASE_URL entirely — the suite then runs against an',
      'in-process Postgres, which is what CI does and needs no credentials.',
    ].join('\n'),
  );
}
