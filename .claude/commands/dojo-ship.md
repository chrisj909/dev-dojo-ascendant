---
description: Commit the current branch and open a pull request with a body that explains the change and how it was verified.
argument-hint: '[optional: a one-line summary to use as the PR title]'
allowed-tools: Read, Grep, Glob, Bash
---

# Ship it

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Changes: !`git status --porcelain`
- Diff against main: !`git diff main...HEAD --stat`

---

Title hint (may be empty): $ARGUMENTS

## Before anything

1. If the branch is `main`, stop. Create a branch first — pushes to `main` are
   blocked by a hook, and `main` is what Vercel deploys to production.
2. Run `npm run check`. Do not open a PR on a red build. If it fails, fix it or
   report and stop.
3. Confirm no secret is staged: `git diff --cached --name-only` must not contain
   `.env`, `.env.local`, or anything holding a connection string. `.env.example`
   is fine and is the only env file that belongs in git.

## Commit

Group into commits that each make sense alone. Conventional prefix matching the
branch type (`fix:`, `feat:`, `chore:`, `test:`, `docs:`).

Subject line: imperative, under 72 characters, describing the effect rather than
the edit. `fix: stop energy banking past the cap during long absences`, not
`fix: update resources.ts`.

Body: why, not what — the diff already says what. If the change encodes a
decision, say what was decided and what was rejected.

End every commit message with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## Push and open the PR

```bash
git push -u origin HEAD
gh pr create --fill --base main
```

Then rewrite the body to this shape — `--fill` alone produces a PR nobody can
review:

```markdown
## What

One paragraph. What behaviour is different now.

## Why

The item this closes, and the design section that governs it
(e.g. "SPEC §7 test 2", "GDD §9.4"). Link the BUGTRAQ/BACKLOG slug.

## How it was verified

- The test that now passes, by name, and what it asserts.
- `npm run check` — pass
- `npm run test:integration` — pass (backend: pglite | neon)
- `npm run verify:rls` — pass, if the database was touched

## Deliberately not done

Anything in scope that was left, and why. Write "nothing" if that is true.

## Risk

What would break if this is wrong, and how it would show up.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Afterwards

Report the PR URL. Check `gh pr checks` once — if CI is already red, say so
rather than leaving it to be discovered later.

Do **not** merge. Merging is a human decision, and `gh pr merge` is configured
to ask.
