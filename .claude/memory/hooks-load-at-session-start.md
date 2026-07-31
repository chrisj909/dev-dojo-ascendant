---
name: hooks-load-at-session-start
description: Claude Code loads hooks when a session begins, so the session that writes them is not governed by them.
metadata:
  type: project
---

Hooks configured in `.claude/settings.json` are read when a session **starts**.
A session that creates or edits them keeps running under the configuration it
began with.

Demonstrated: after `guard-secrets.mjs` was written and its rules unit-tested, a
command containing `DROP TABLE` ran to completion in the same session. The rule
was correct; Claude Code simply was not invoking it.

**Why this matters more than it sounds:** it makes a specific, comfortable
verification claim false. "I tested the hook end to end" usually means _payloads
were piped through the hook's stdin contract and it refused them_ — which proves
the rules work, and proves nothing about whether the tool actually calls it.
Those are separate claims and only one of them was ever checked.

**How to apply:** after changing anything under `.claude/`, confirm it is live in
a **fresh** session before relying on it — try something harmless that should be
refused and check that it is. This matters most for `npm run loop`, which starts
a new process per pass and therefore does pick the hooks up; the unattended path
is the guarded one, and an interactive session that just edited the rules is
not. See [[safety-rules-fail-by-looking-right]].
