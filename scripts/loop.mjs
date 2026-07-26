#!/usr/bin/env node
/**
 * Runs `/dojo-loop` unattended, one item per invocation.
 *
 *   npm run loop              one pass
 *   npm run loop -- --n 5     five passes, stopping early on failure
 *   npm run loop -- --dry     print the command without running it
 *
 * Each pass is a FRESH Claude Code process. That is the point, not an
 * accident: one item per context means the agent cannot accumulate a
 * half-remembered theory across six unrelated tasks, and a bad pass is bounded
 * by that item rather than poisoning the rest.
 *
 * Permission prompts are disabled — there is nobody at the keyboard. What
 * replaces them is `.claude/hooks/guard-secrets.mjs`, which blocks force-push,
 * pushes to main, hard resets, destructive DDL and anything that would stage or
 * print a secret. Those rules live in a file you can read and change, rather
 * than in whoever happens to be watching the terminal.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const nIndex = args.indexOf('--n');
const passes = nIndex >= 0 ? Math.max(1, Number(args[nIndex + 1]) || 1) : 1;
const slugIndex = args.indexOf('--slug');
const slug = slugIndex >= 0 ? args[slugIndex + 1] : '';

if (!existsSync('BACKLOG.md') || !existsSync('BUGTRAQ.md')) {
  console.error('Run this from the repository root — BACKLOG.md and BUGTRAQ.md must be present.');
  process.exit(1);
}

const prompt = slug ? `/dojo-loop ${slug}` : '/dojo-loop';

const claudeArgs = [
  '-p',
  prompt,
  '--dangerously-skip-permissions',
  '--max-turns',
  '200',
  '--output-format',
  'stream-json',
  '--verbose',
];

if (dry) {
  console.log(
    `claude ${claudeArgs.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`,
  );
  process.exit(0);
}

for (let pass = 1; pass <= passes; pass += 1) {
  console.log(`\n─── loop pass ${pass}/${passes} ${'─'.repeat(40)}\n`);

  const result = spawnSync('claude', claudeArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(`\nCould not run \`claude\`: ${result.error.message}`);
    console.error('Install it with: npm i -g @anthropic-ai/claude-code');
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `\nPass ${pass} exited ${result.status}. Stopping rather than compounding a failure.`,
    );
    process.exit(result.status ?? 1);
  }
}

console.log(`\n${passes} pass(es) complete. Review the open PRs before merging anything.`);
