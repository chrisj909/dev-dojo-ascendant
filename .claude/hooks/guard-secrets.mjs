#!/usr/bin/env node
/**
 * PreToolUse(Bash) — refuse the commands that are unrecoverable or that leak
 * credentials.
 *
 * This harness runs with permission prompts disabled so the loop can work
 * unattended. That removes the human "are you sure" for everything, so the
 * handful of commands that genuinely warrant one are enforced here instead,
 * where the rule is explicit, reviewable, and tested.
 *
 * The rules themselves live in ./command-rules.mjs and are covered by
 * tests/unit/command-rules.test.ts. This file is only the plumbing: read the
 * payload, resolve the current branch, apply the rules, exit.
 *
 * Exit code 2 blocks the call and returns stderr to the agent as feedback.
 *
 * FAILS CLOSED. Earlier this exited 0 — allowing the command — when stdin was
 * empty, unparseable, or shaped unexpectedly. For a control that is the last
 * thing between an unattended run and a destroyed database, "I did not
 * understand the question" must not mean "go ahead".
 */

import { execFileSync } from 'node:child_process';

import { evaluate } from './command-rules.mjs';

function block(message) {
  process.stderr.write(`Blocked by .claude/hooks/guard-secrets.mjs\n\n${message}\n`);
  process.exit(2);
}

async function readPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The branch a bare `git push` would push. Null when it cannot be determined. */
function currentBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const payload = await readPayload();
if (payload === null) {
  block('Could not read the tool payload, so this command could not be checked.');
}

const command = payload?.tool_input?.command;
if (typeof command !== 'string') {
  block(
    'Expected a string command to check and did not get one, so this call could not be verified.',
  );
}

const branch = currentBranch();
const rule = evaluate(command, { currentBranch: branch });

if (rule) block(rule.reason);

// A `git push` whose target depends on the checked-out branch, when the branch
// could not be resolved, is refused rather than guessed at.
if (/\bgit\s+push\b/.test(command) && branch === null) {
  block(
    'Could not determine the current branch, so it is not possible to tell whether this pushes ' +
      'to main. Run `git rev-parse --abbrev-ref HEAD` and push an explicit refspec.',
  );
}

process.exit(0);
