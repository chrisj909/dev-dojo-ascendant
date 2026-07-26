#!/usr/bin/env node
/**
 * PreToolUse(Bash) — refuse the small number of commands that are unrecoverable
 * or that leak credentials.
 *
 * This harness runs with permission prompts disabled so the loop can work
 * unattended. That removes the human "are you sure" for everything, so the
 * handful of commands that genuinely warrant one are enforced here instead,
 * where the rule is explicit and reviewable rather than living in whoever
 * happens to be watching.
 *
 * Exit code 2 blocks the call and returns stderr to the agent as feedback.
 */

const BLOCKED = [
  {
    // `git add .env.local` or any force-add of an ignored env file.
    pattern: /git\s+add\b[^\n]*(?:\s|\/)\.env(?:\.|$|\s)/,
    reason:
      'That would stage an env file. Secrets never enter git — .env.local is gitignored on purpose. ' +
      'If you need to document a new variable, add it to .env.example with a placeholder value.',
  },
  {
    pattern: /git\s+push\b[^\n]*(?:--force\b|-f\b)(?![\w-])/,
    reason:
      'Force-push is blocked. If history needs rewriting, say what and why and let a human do it. ' +
      'To update a PR branch, push normally — the PR follows the branch.',
  },
  {
    pattern: /git\s+push\b[^\n]*\s(?:origin\s+)?(?:HEAD:)?main\b/,
    reason:
      'Direct pushes to main are blocked. Branch, then open a PR with `/dojo-ship`. ' +
      'main is what Vercel deploys to production.',
  },
  {
    pattern: /git\s+reset\s+--hard/,
    reason:
      'git reset --hard discards uncommitted work irreversibly. Use `git stash` if you need a clean tree.',
  },
  {
    pattern: /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i,
    reason:
      'Destructive DDL is blocked outside a reviewed migration. Write it as a drizzle migration in drizzle/ so it is versioned and reviewable.',
  },
  {
    pattern: /\bTRUNCATE\b/i,
    reason:
      'TRUNCATE against the configured database is blocked. The integration suite truncates its own test database via the harness; nothing else should.',
  },
  {
    // Printing a connection string into the transcript.
    pattern: /(?:cat|type|Get-Content)\s+[^\n|]*\.env(?:\.local|\.production)?\b/,
    reason:
      'That would print secrets into the transcript. Read .env.example instead — it lists every variable with placeholder values.',
  },
];

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
const command = payload?.tool_input?.command;
if (typeof command !== 'string') process.exit(0);

for (const rule of BLOCKED) {
  if (rule.pattern.test(command)) {
    process.stderr.write(`Blocked by .claude/hooks/guard-secrets.mjs\n\n${rule.reason}\n`);
    process.exit(2);
  }
}

process.exit(0);
