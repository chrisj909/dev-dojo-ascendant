---
description: Pick the single highest-priority item from BUGTRAQ.md or BACKLOG.md, implement it test-first, and ship it as a PR. One item per run.
argument-hint: '[optional: a slug to force, e.g. energy-overflows-at-cap]'
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Agent, TodoWrite
---

# Autonomous work loop

Current state:

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Working tree: !`git status --porcelain | wc -l` uncommitted file(s)
- Open bugs: !`grep -c "^\s*-\s*\[ \]" BUGTRAQ.md || echo 0`
- Open backlog: !`grep -c "^\s*-\s*\[ \]" BACKLOG.md || echo 0`

@BUGTRAQ.md
@BACKLOG.md

---

You are running unattended. **Do exactly one item, completely, then stop.**

Requested item (may be empty — if so, choose): $ARGUMENTS

## 0. Refuse to start if the ground is not solid

Run these first. If any fails, the failure IS the item — fix that instead and
say so:

```bash
npm run check
```

If the working tree is dirty on `main`, stop and report rather than building on
top of someone else's uncommitted work.

## 1. Choose the item

Strict order. Do not deviate:

1. Any `P0` in `BUGTRAQ.md`.
2. Any `P1` in `BUGTRAQ.md`.
3. The first unchecked `P0`, then `P1`, then `P2` in `BACKLOG.md` **that belongs
   to the current phase**. The phase is the `current_phase:` line at the top of
   `BACKLOG.md`.
4. Remaining `P2` bugs.

**Never start work belonging to a later phase.** `IMPLEMENTATION_SPEC.md` §6 is
explicit that a phase does not begin until the previous one has a passing test
suite, and §8 warns that this design has enough interlocking systems that an
unbounded session produces something plausible and wrong. If every in-phase item
is done, say the phase is complete, summarise what would close it out, and stop.
Do not help yourself to the next phase.

If an item is too vague to implement, do not guess. Mark it `needs-definition`
in the file, explain what decision is missing, and move to the next item.

## 2. Check it against the design

Use the **spec-guardian** subagent on the chosen item before writing code. If it
returns `BLOCKED`, do not proceed — record why in the item and stop.

## 3. Branch

```bash
git switch -c <type>/<slug>
```

`<type>` is `fix` for a bug, `feat` for a backlog feature, `chore` otherwise.
`<slug>` is the item's existing slug, unchanged.

## 4. Test first — this is not optional

Use the **test-author** subagent. For a bug, the regression test reproduces it.
For a feature, the test encodes the acceptance criterion from the item.

**Run the test and watch it fail before writing any implementation.** Confirm it
fails for the right reason. Paste the failure into your notes; you will need it
for the PR body.

If the test passes immediately, the item is either already done or the test is
wrong. Work out which. Do not proceed on a green test you never saw fail.

## 5. Implement

The smallest change that makes the test pass. Then:

- Every tuning number goes in `lib/constants.ts` (SPEC §4).
- Anything touching the schema, migrations or policies goes through the
  **db-steward** subagent.
- Anything changing a constant's value goes through the **balance-analyst**
  subagent first — that is a design decision and needs evidence.

## 6. Verify properly

```bash
npm run check
npm run test:integration
```

And if the change touched the database at all:

```bash
npm run verify:rls
```

All must pass. Do not proceed with a known failure, and never weaken a test to
make it green — if a test is genuinely wrong, that is its own item with its own
justification.

## 7. Review

Use the **change-reviewer** subagent on the diff. Fix everything it marks
blocking, then re-run step 6. Record non-blocking findings as new `P2` entries
in `BACKLOG.md` rather than fixing them here — scope creep is how one item
becomes six.

## 8. Ship

Mark the item `- [x]` in its file, with the PR number appended once you have it.
Then run `/dojo-ship`.

## 9. Report and stop

Say, in a few lines: which item, what changed, the test that now passes, the PR
link, and anything you deliberately left. Then **stop**. Do not pick up another
item — a fresh run gets a fresh context, and that is the point.

If you could not finish, say exactly where you stopped and what the next step
is. A half-finished item honestly reported is worth more than a finished-looking
one that is not.
