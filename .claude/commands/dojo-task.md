---
description: Add a well-formed item to BACKLOG.md, with acceptance criteria the loop can actually verify.
argument-hint: '<what you want built>'
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Agent
---

@BACKLOG.md

Request: $ARGUMENTS

---

Turn this into a backlog item that `/dojo-loop` can pick up and finish without
asking a question.

## Work out which phase it belongs to

`IMPLEMENTATION_SPEC.md` §6 sequences the build. File the item under its phase,
not under the current one, even if it is wanted sooner — the sequencing is what
stops the interlocking systems being built in the wrong order.

## The item must have

- A stable kebab-case slug. Branch names and commits will use it.
- A priority within its phase.
- **Acceptance criteria stated as something testable.** Not "recruitment feels
  good" but "a recruit pool of 5 refreshes every 6 hours and cannot be refreshed
  early by reloading". If you cannot write a testable criterion, the item is not
  ready — mark it `needs-definition` and say what decision is missing.
- The governing spec or GDD section.
- Any constants it introduces, named, so they land in `lib/constants.ts` rather
  than being invented at implementation time.

## Check it against the design first

Use the **spec-guardian** subagent. If the request contradicts the GDD, say so
plainly and quote the section. GDD §14 lists what is deliberately out of scope
for MVP and §5.2 permanently forbids purchasable Energy or Focus — requests in
those areas get a clear "no, and here is why", not a backlog entry.

If it touches one of the five open design questions in GDD §15, note which.
