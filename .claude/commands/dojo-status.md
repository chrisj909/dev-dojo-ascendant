---
description: Where the project actually is — phase, open work, CI, deploys, and whether the database is configured correctly.
allowed-tools: Read, Grep, Glob, Bash
---

# Status

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Working tree: !`git status --short`
- Recent commits: !`git log --oneline -8`
- Open PRs: !`gh pr list --limit 10 2>/dev/null || echo "(gh unavailable)"`
- Last CI runs: !`gh run list --limit 5 2>/dev/null || echo "(gh unavailable)"`

@BUGTRAQ.md
@BACKLOG.md

---

Report, briefly:

1. **Phase** — the `current_phase:` value, and what still stands between here
   and its "Done when" condition in `IMPLEMENTATION_SPEC.md` §6.
2. **Open work** — bug and backlog counts by priority. Name any P0.
3. **Health** — run `npm run check`. If the database is reachable, run
   `npm run verify:rls` and report its verdict.
4. **In flight** — open PRs and whether their checks are green.
5. **The one thing to do next**, and why it is that rather than something else.

No preamble, no restating what was asked. If the project is in good shape, say
so in a sentence and stop.
