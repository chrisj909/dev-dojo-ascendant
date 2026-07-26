#!/usr/bin/env node
/**
 * PostToolUse(Edit|Write) — enforce IMPLEMENTATION_SPEC.md §4:
 *
 *   "Put these in lib/constants.ts and never inline a magic number anywhere
 *    else."
 *
 * That rule is the difference between a game you can retune in one file and a
 * game whose balance is smeared across forty. It is also exactly the rule an
 * agent breaks without noticing, because inlining `0.35` right where it is used
 * always looks like the tidier change.
 *
 * ADVISORY, NOT BLOCKING. It feeds a note back into the transcript rather than
 * rejecting the edit, because the heuristic cannot tell a tuning value from an
 * array index and a false block is far more expensive than a false note.
 */

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

/** Only game logic is in scope. UI spacing and test fixtures are not tuning. */
const WATCHED = [/^lib\/game\//, /^lib\/repo\//, /^lib\/actions\//];

const EXEMPT = [
  /^lib\/constants\.ts$/,
  /^lib\/db\/seed\//, // content, not tuning
];

/**
 * Numbers that carry no balance meaning. 0/1/2 are structural, 100 is a
 * percentage, 1000/60/24 are unit conversions, -1 is a sentinel.
 */
const BENIGN = new Set([0, 1, 2, -1, 100, 60, 24, 1000, 365]);

async function readPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

const payload = await readPayload();
const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

const rel = relative(process.cwd(), resolve(filePath)).replace(/\\/g, '/');
if (!WATCHED.some((re) => re.test(rel))) process.exit(0);
if (EXEMPT.some((re) => re.test(rel))) process.exit(0);

let source = '';
try {
  source = readFileSync(resolve(filePath), 'utf8');
} catch {
  process.exit(0);
}

const findings = [];
const lines = source.split('\n');

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];

  // Skip comments, imports, and type-only lines.
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
    continue;
  }
  if (/^import\s|^export\s+type\s|^type\s/.test(trimmed)) continue;

  // Strip string literals so text like "3 students" is not flagged.
  const code = line
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/\/\/.*$/, '');

  for (const match of code.matchAll(/(?<![\w.$])(\d+\.\d+|\d+)(?![\w.])/g)) {
    const value = Number(match[1]);
    if (BENIGN.has(value)) continue;
    // Array indexing and .slice(0, 8) style calls are structural.
    const before = code.slice(Math.max(0, match.index - 2), match.index);
    if (before.endsWith('[')) continue;

    findings.push(`  ${rel}:${i + 1}  ${match[1]}   ${trimmed.slice(0, 80)}`);
  }
}

if (findings.length === 0) process.exit(0);

const message =
  `Possible inlined tuning values in ${rel}. IMPLEMENTATION_SPEC.md §4 requires every ` +
  `number that affects game feel to live in lib/constants.ts:\n\n${findings.slice(0, 12).join('\n')}\n\n` +
  `If these are genuinely structural (indices, lengths, HTTP codes) ignore this. ` +
  `If any of them is a rate, cost, cap, chance, or multiplier, move it to lib/constants.ts and import it.`;

// hookSpecificOutput.additionalContext surfaces this to the agent without
// rejecting the edit.
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: message,
    },
  }),
);
process.exit(0);
