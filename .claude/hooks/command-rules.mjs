/**
 * The rules `guard-secrets.mjs` enforces, separated so they can be tested.
 *
 * This harness runs with permission prompts disabled so the loop can work
 * unattended. That removes the human "are you sure" from everything, so these
 * rules are the only thing standing between an automated run and an
 * unrecoverable action. Two of them were previously wrong in ways that read as
 * protective:
 *
 *   - The main-branch rule required the literal `main` preceded by whitespace,
 *     so a bare `git push` while standing on main sailed through, as did
 *     `git push origin +main` — which defeated the force-push rule at the same
 *     time.
 *   - Nothing at all covered `db:migrate`, `db:seed` or `db:app-role`. Those
 *     resolve to the LIVE Neon database from .env.local, and the only guard was
 *     an `ask` permission entry, which is inert under `bypassPermissions`. The
 *     db-steward agent's own instructions tell it to run `npm run db:migrate`.
 *
 * Both were found by adversarial review after shipping. Hence this file, and
 * hence tests/unit/command-rules.test.ts.
 */

/**
 * Does this command push to `main`?
 *
 * `currentBranch` matters because `git push` with no refspec pushes the branch
 * you are standing on, and so does `git push -u origin HEAD`. Neither mentions
 * `main` anywhere in the text.
 */
export function pushesToMain(command, currentBranch) {
  if (!/\bgit\s+push\b/.test(command)) return false;

  // Any explicit mention of main as a ref: `main`, `origin main`, `HEAD:main`,
  // `+main`, `branch:main`, `refs/heads/main`, `HEAD:refs/heads/main`.
  if (/(?:^|[\s:+])(?:refs\/heads\/)?main\b/.test(command.replace(/\bgit\s+push\b/, ''))) {
    return true;
  }

  // No explicit source ref — the push targets whatever branch is checked out.
  const rest = command.replace(/^[^]*?\bgit\s+push\b/, '');
  const positional = rest
    .split(/\s+/)
    .filter((token) => token && !token.startsWith('-'))
    // Drop anything after a shell separator; it is a different command.
    .filter((token) => !/^[;&|]/.test(token));

  // positional[0] is the remote, positional[1] the refspec. `HEAD` resolves to
  // the current branch, so it counts as "no explicit ref" for our purposes.
  const refspec = positional[1];
  const implicit = refspec === undefined || /^HEAD(?::HEAD)?$/.test(refspec);

  return implicit && currentBranch === 'main';
}

/**
 * Commands that write to whichever database `.env.local` points at — which,
 * on a developer machine, is production.
 */
const DATABASE_MUTATIONS =
  /(?:\bnpm\s+run\s+(?:db:migrate|db:seed|db:app-role|db:push)\b)|(?:\bscripts\/(?:migrate|seed|create-app-role)\.ts\b)|(?:\bdrizzle-kit\s+(?:push|migrate)\b)/;

/** Any reference to a real env file. `.env.example` is the one that is safe. */
const ENV_FILE = /(?:^|[\s'"=/(])\.env(?![\w.-]*\.example\b)(?:\.[\w-]+)*\b|\.env\*/;

/** Programs that actually execute SQL. */
const SQL_CLIENT = /\b(?:psql|pgcli|pg_dump|pg_restore)\b/;

/** A heredoc body: `<<EOF` or `<<'EOF'`, through to the closing marker. */
const HEREDOC = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?[\s\S]*?^\1[ \t]*$/gm;

/**
 * Strip heredoc bodies before matching SQL keywords, unless the command
 * actually invokes a SQL client.
 *
 * A heredoc body is DATA being written somewhere — a file, a commit message —
 * not a statement being executed. Matching SQL keywords inside one blocked a
 * commit whose message merely *described* a destructive statement, which is a
 * false positive that would hit the loop constantly: commit messages and
 * documentation routinely name the thing they are about.
 *
 * When a SQL client IS present the body is very likely being fed to it, so the
 * whole command is matched exactly as before. An inline `node -e "... DROP
 * TABLE ..."` has no heredoc and is still matched directly.
 */
function executable(command) {
  if (SQL_CLIENT.test(command)) return command;
  return command.replace(HEREDOC, ' <heredoc> ');
}

export const RULES = [
  {
    id: 'db-mutation',
    test: (command) => DATABASE_MUTATIONS.test(command),
    reason:
      'Blocked: this writes to whatever database .env.local points at, which is the live one.\n\n' +
      'Migrations reach production through .github/workflows/migrate.yml on merge to main, ' +
      'reviewed first (docs/DECISIONS.md D7). An unattended run must not apply unreviewed DDL, ' +
      'overwrite live region tuning, or mint a database password into its own transcript.\n\n' +
      'To change the schema: write the migration, open a PR, let CI apply it after review.',
  },
  {
    id: 'push-to-main',
    test: (command, ctx) => pushesToMain(command, ctx.currentBranch),
    reason:
      'Blocked: this pushes to main, which is what Vercel deploys to production.\n\n' +
      'Branch first, then open a PR with `/dojo-ship`. Note that a bare `git push` while ' +
      'standing on main counts, and so does `git push -u origin HEAD`.',
  },
  {
    id: 'force-push',
    test: (command) =>
      /git\s+push\b[^\n]*(?:--force\b|--force-with-lease\b|\s-f\b|\s\+)/.test(command),
    reason:
      'Force-push is blocked. If history genuinely needs rewriting, say what and why and let a ' +
      'human do it. To update a PR branch, push normally — the PR follows the branch.',
  },
  {
    id: 'stage-env',
    test: (command) => /\bgit\s+add\b/.test(command) && ENV_FILE.test(command),
    reason:
      'That would stage an env file. Secrets never enter git — .env.local is gitignored on ' +
      'purpose. To document a new variable, add it to .env.example with a placeholder.',
  },
  {
    id: 'read-env',
    // Not an allow-list of readers: `cat`, `head`, `grep`, `node -e`, `Get-Content`
    // and a dozen others all print a file, and enumerating them is a losing game.
    // Any command naming a real env file is refused instead.
    test: (command) => ENV_FILE.test(command) && !/\bgit\s+add\b/.test(command),
    reason:
      'That would put secrets in the transcript, which the loop prints and stores. ' +
      'Read .env.example instead — it lists every variable with placeholder values.',
  },
  {
    id: 'hard-reset',
    test: (command) => /git\s+reset\s+--hard/.test(command),
    reason:
      'git reset --hard discards uncommitted work irreversibly. Use `git stash` for a clean tree.',
  },
  {
    id: 'destructive-ddl',
    test: (command) => /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i.test(executable(command)),
    reason:
      'Destructive DDL is blocked outside a reviewed migration. Write it as a drizzle migration ' +
      'in drizzle/ so it is versioned and reviewable.',
  },
  {
    id: 'truncate',
    test: (command) => /\bTRUNCATE\b/i.test(executable(command)),
    reason:
      'TRUNCATE is blocked. The integration suite truncates its own test database through the ' +
      'harness, which refuses to run against the application database; nothing else should.',
  },
];

/**
 * Evaluate a command. Returns the first matching rule, or null.
 *
 * `ctx.currentBranch` may be null when it cannot be determined — in which case
 * branch-dependent rules do not fire, and the caller decides what to do.
 */
export function evaluate(command, ctx = {}) {
  if (typeof command !== 'string') return null;
  for (const rule of RULES) {
    if (rule.test(command, { currentBranch: ctx.currentBranch ?? null })) return rule;
  }
  return null;
}
