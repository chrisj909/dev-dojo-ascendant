import { defineConfig } from 'vitest/config';

/**
 * Two projects, deliberately separate.
 *
 *   unit        Pure logic. No database, no network, no wall clock. Runs
 *               anywhere, including on a machine that has never seen a
 *               connection string. This is what `npm test`, the pre-push hook
 *               and every CI job run.
 *
 *   integration Real Postgres. Proves the row-level security policies actually
 *               deny cross-tenant access (SPEC §7 test 12), which cannot be
 *               demonstrated without a server that enforces roles and policies.
 *               Requires TEST_DATABASE_URL and skips loudly without it.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/integration/setup.ts'],
          // Migrations, role creation and policy checks are slower than unit
          // work and must never run concurrently against one database.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
