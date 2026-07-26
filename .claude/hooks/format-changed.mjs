#!/usr/bin/env node
/**
 * PostToolUse(Edit|Write|MultiEdit) — run Prettier on the file that just changed.
 *
 * Formatting on write rather than in review means no turn is ever spent on
 * whitespace and diffs stay about behaviour. Node rather than a shell script so
 * it behaves identically on Windows, macOS and Linux.
 *
 * Never blocks. A formatter failure is not a reason to stop work.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const FORMATTABLE = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.md',
  '.yml',
  '.yaml',
]);

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

const absolute = resolve(filePath);
if (!existsSync(absolute) || !FORMATTABLE.has(extname(absolute))) process.exit(0);

// Paths outside the repo are none of our business.
const rel = relative(process.cwd(), absolute);
if (rel.startsWith('..')) process.exit(0);

try {
  // Prettier honours .prettierignore, which excludes drizzle/ — reformatting a
  // migration changes the checksum drizzle uses to decide what has already run.
  execFileSync('npx', ['prettier', '--write', '--ignore-unknown', '--log-level', 'error', rel], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
    timeout: 30_000,
  });
} catch {
  // Usually a syntax error mid-edit. Leave it; tsc or the test run will say so
  // far more usefully than this hook could.
}

process.exit(0);
