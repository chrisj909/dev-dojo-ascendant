---
name: stdout-banners-poison-pipes
description: dotenv prints a banner to stdout, which silently corrupts any value piped out of a node one-liner — including secrets.
metadata:
  type: project
---

`dotenv`'s `config()` writes a banner to **stdout**, not stderr:

```
◇ injected env (7) from .env.local // tip: ⌁ auth for agents [www.vestauth.com]
```

Anything piping a value out of a `node -e` that loads dotenv therefore emits
`banner + newline + value`. Setting the GitHub Actions secret this way stored
236 bytes for a 141-character connection string, and the migration workflow
failed with `(unparseable connection string)` — a message that reads like a
malformed URL rather than a polluted pipe.

**Why:** the value is never printed, so nothing looks wrong at the shell. The
corruption only surfaces wherever the value is finally used, which may be a
different machine and a different day.

**How to apply:** always pass `quiet: true` when the output is piped —
`require('dotenv').config({ path: '.env.local', quiet: true })`. Every script in
`scripts/` already does. Verify a piped secret by byte count before trusting it:

```
node -e "require('dotenv').config({path:'.env.local',quiet:true});process.stdout.write(process.env.X)" | wc -c
```

Generalises past dotenv: any library that greets you on stdout will do this. If
a pipeline carries a value rather than a report, check the byte count.
