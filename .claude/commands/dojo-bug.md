---
description: File a bug into BUGTRAQ.md — reproduced, prioritised, and with a failing test.
argument-hint: '<what went wrong, in your own words>'
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Agent
---

@BUGTRAQ.md

Report: $ARGUMENTS

---

Use the **bug-triager** subagent to turn this into an entry.

It must come back with:

1. A reproduction you have actually run, or an explicit statement that it could
   not be reproduced plus what was tried.
2. A **failing test**, committed, in `tests/unit/` or `tests/integration/`.
3. A priority, with the reasoning stated in one line.
4. An entry appended to `BUGTRAQ.md` in the existing format — the loop parses
   this file, so the format is a contract.

Do not fix the bug. Filing and fixing are separate on purpose: the fix should be
picked up by `/dojo-loop` with a fresh context that has not already talked
itself into a theory.

If the report describes intended behaviour that the reporter dislikes, say so —
that is a `BACKLOG.md` design item, not a bug, and it belongs in a different
file with a different conversation attached to it.
