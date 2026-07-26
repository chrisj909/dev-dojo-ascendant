/**
 * The rules that stand in for a human when the loop runs unattended.
 *
 * `.claude/settings.json` sets `bypassPermissions` and `scripts/loop.mjs` passes
 * `--dangerously-skip-permissions`, because there is nobody at the keyboard.
 * These rules are therefore the ONLY control on the handful of commands that
 * cannot be undone. Two of them were wrong in ways that read as protective, and
 * both were found by adversarial review after they had shipped:
 *
 *   - `git push` while standing on main was allowed, as was
 *     `git push origin +main` — which defeated the force rule at the same time.
 *   - `db:migrate` / `db:seed` / `db:app-role` were not covered at all. They
 *     resolve to the live Neon database from `.env.local`.
 *
 * A security control with no tests is how that happened, so: tests.
 */

import { describe, expect, it } from 'vitest';

// Plain ESM, deliberately not TypeScript: Claude Code executes these hooks
// directly with node, so they must not need a build step.
import { evaluate, pushesToMain } from '@/.claude/hooks/command-rules.mjs';

const blocked = (command: string, currentBranch: string | null = 'feature/x') =>
  evaluate(command, { currentBranch })?.id ?? null;

describe('pushes to main', () => {
  it('blocks the spellings that name main outright', () => {
    for (const command of [
      'git push origin main',
      'git push origin HEAD:main',
      'git push origin main:main',
      'git push origin HEAD:refs/heads/main',
      'git push origin refs/heads/main',
      'git push -u origin main',
      'git push --set-upstream origin main',
    ]) {
      expect(blocked(command), command).toBe('push-to-main');
    }
  });

  it('blocks a bare push while standing on main', () => {
    // No occurrence of the word "main" anywhere in the command. This is the one
    // the original rule missed entirely.
    expect(blocked('git push', 'main')).toBe('push-to-main');
    expect(blocked('git push -u origin HEAD', 'main')).toBe('push-to-main');
    expect(blocked('git push origin', 'main')).toBe('push-to-main');
  });

  it('blocks a force-push to main, which previously defeated both rules at once', () => {
    // `+main` is a force refspec. The old main rule wanted whitespace before
    // `main`, and the old force rule wanted `--force` or `-f`.
    expect(blocked('git push origin +main')).not.toBeNull();
    expect(blocked('git push --force origin main')).not.toBeNull();
    expect(blocked('git push -f origin main')).not.toBeNull();
  });

  it('allows an ordinary push of a feature branch', () => {
    expect(blocked('git push -u origin HEAD', 'fix/something')).toBeNull();
    expect(blocked('git push origin fix/something', 'fix/something')).toBeNull();
    expect(blocked('git push', 'fix/something')).toBeNull();
  });

  it('does not fire on a branch whose name merely contains main', () => {
    expect(blocked('git push origin maintenance', 'maintenance')).toBeNull();
    expect(blocked('git push origin fix/domain-setup', 'fix/domain-setup')).toBeNull();
  });

  it('leaves the branch-dependent case alone when the branch is unknown', () => {
    // The hook decides what to do with an undeterminable branch; the rule
    // itself must not guess.
    expect(pushesToMain('git push', null)).toBe(false);
    expect(pushesToMain('git push origin main', null)).toBe(true);
  });
});

describe('writes to the live database', () => {
  it('blocks every script that resolves DATABASE_URL from .env.local', () => {
    for (const command of [
      'npm run db:migrate',
      'npm run db:seed',
      'npm run db:app-role',
      'npm run db:push',
      'npx tsx scripts/migrate.ts',
      'npx tsx scripts/seed.ts',
      'npx tsx scripts/create-app-role.ts',
      'node scripts/seed.ts',
      'npx drizzle-kit push',
      'npx drizzle-kit migrate',
    ]) {
      expect(blocked(command), command).toBe('db-mutation');
    }
  });

  it('allows the read-only and generative ones', () => {
    // These are how an agent is supposed to work on the schema.
    expect(blocked('npm run verify:rls')).toBeNull();
    expect(blocked('npm run db:generate')).toBeNull();
    expect(blocked('npm run db:custom')).toBeNull();
    expect(blocked('npm run test:integration')).toBeNull();
  });
});

describe('env files', () => {
  it('blocks reading one however it is spelled', () => {
    for (const command of [
      'cat .env.local',
      'head -50 .env.local',
      'tail .env',
      'grep DATABASE_URL .env.local',
      'less .env.production',
      'Get-Content .env.local',
      "node -e \"console.log(require('fs').readFileSync('.env.local','utf8'))\"",
      'cp .env.local /tmp/x',
    ]) {
      expect(blocked(command), command).toBe('read-env');
    }
  });

  it('blocks staging one', () => {
    expect(blocked('git add .env.local')).toBe('stage-env');
    expect(blocked('git add -f .env*')).toBe('stage-env');
    expect(blocked('git add -A .env.production.local')).toBe('stage-env');
  });

  it('allows .env.example, which is the whole point of it existing', () => {
    expect(blocked('cat .env.example')).toBeNull();
    expect(blocked('git add .env.example')).toBeNull();
    expect(blocked('cp .env.example .env.local')).toBe('read-env'); // writes a real env file
  });

  it('does not fire on unrelated words containing env', () => {
    expect(blocked('npm run dev')).toBeNull();
    expect(blocked('echo $ENVIRONMENT')).toBeNull();
    expect(blocked('node -e "process.env.NODE_ENV"')).toBeNull();
  });
});

describe('the rest', () => {
  it('blocks a hard reset', () => {
    expect(blocked('git reset --hard origin/main')).toBe('hard-reset');
  });

  it('blocks destructive DDL and TRUNCATE in any casing', () => {
    expect(blocked('psql -c "drop table players"')).toBe('destructive-ddl');
    expect(blocked('psql -c "TRUNCATE dojos"')).toBe('truncate');
  });

  it('allows ordinary work', () => {
    for (const command of [
      'npm run check',
      'npm test',
      'git status',
      'git commit -m "fix: thing"',
      'gh pr create --fill',
      'npx tsc --noEmit',
    ]) {
      expect(blocked(command), command).toBeNull();
    }
  });
});

describe('evaluate', () => {
  it('returns null for a non-string, leaving the decision to the caller', () => {
    expect(evaluate(undefined)).toBeNull();
    expect(evaluate(['git', 'push'])).toBeNull();
  });
});
