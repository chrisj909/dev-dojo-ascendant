/**
 * Stub for the `server-only` package under Vitest.
 *
 * `server-only` exists to make a build fail when a server module is imported
 * from a client component. It does that by resolving to a module that throws
 * under the browser condition — which is what Vitest picks up, so importing
 * `lib/repo/dojo.ts` in a test would blow up for a reason that has nothing to
 * do with the test.
 *
 * The integration project aliases the package here. The real guard still
 * applies where it matters: `next build` uses the genuine package.
 */
export {};
