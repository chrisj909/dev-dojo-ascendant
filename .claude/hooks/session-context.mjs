#!/usr/bin/env node
/**
 * SessionStart — put the state of the work in front of the agent before it is
 * asked anything.
 *
 * Without this, every session opens by re-reading BUGTRAQ.md and BACKLOG.md to
 * work out what is going on. This is cheaper, and it means the current phase is
 * stated up front — which is the single fact most likely to stop an agent
 * wandering into Phase 4 work while Phase 2 is still open.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { countOpen } from './work-items.mjs';

function read(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  } catch {
    return '';
  }
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

const bugtraq = countOpen(read('BUGTRAQ.md'));
const backlog = countOpen(read('BACKLOG.md'));

const phaseMatch = read('BACKLOG.md').match(/^current_phase:\s*(.+)$/m);
const phase = phaseMatch ? phaseMatch[1].trim() : 'unknown';

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const dirty = git(['status', '--porcelain']);
const changed = dirty ? dirty.split('\n').filter(Boolean).length : 0;

const lines = [
  `Current build phase: ${phase} (see IMPLEMENTATION_SPEC.md §6).`,
  `Do not start work belonging to a later phase without being asked.`,
  ``,
  `BUGTRAQ.md: ${bugtraq.total} open (P0 ${bugtraq.byPriority.P0}, P1 ${bugtraq.byPriority.P1}, P2 ${bugtraq.byPriority.P2})`,
  `BACKLOG.md: ${backlog.total} open (P0 ${backlog.byPriority.P0}, P1 ${backlog.byPriority.P1}, P2 ${backlog.byPriority.P2})`,
  `Branch: ${branch || 'unknown'}${changed ? ` — ${changed} uncommitted file(s)` : ' — clean'}`,
];

if (bugtraq.byPriority.P0 > 0) {
  lines.push(``, `There is an open P0 bug. It outranks every backlog item.`);
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lines.join('\n'),
    },
  }),
);
process.exit(0);
