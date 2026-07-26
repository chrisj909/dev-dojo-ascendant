# Dojo Ascendant

> You are a headmaster, not a fighter.

You recruit students, put them through curricula, and raise them to mastery.
When a student surpasses your teaching they **graduate and found a branch dojo**
under your school — and your power grows not by accumulating fighters, but by
accumulating **generations**.

Browser-based, asynchronous, server-authoritative. No twitch input. Sessions are
two minutes or fifteen, never forty.

**Status: Phase 1 (Skeleton) complete.** Auth, player and dojo creation, region
seed data, and lazy Energy/Focus regeneration. Roster and drills are Phase 2 —
see [`BACKLOG.md`](BACKLOG.md).

---

## Stack

| Layer     | Choice                                      |
| --------- | ------------------------------------------- |
| Framework | Next.js 16 (App Router) + TypeScript        |
| Styling   | Tailwind CSS 4                              |
| Database  | Neon Postgres + Drizzle ORM                 |
| Auth      | Auth.js v5 (GitHub OAuth + local dev login) |
| Hosting   | Vercel, deploying from GitHub               |
| Tests     | Vitest — unit, plus integration on PGlite   |

Two design documents govern everything: [`DOJO_ASCENDANT_GDD.md`](DOJO_ASCENDANT_GDD.md)
for what the game is, [`IMPLEMENTATION_SPEC.md`](IMPLEMENTATION_SPEC.md) for how
it is built. When they disagree, the GDD wins on intent and the spec wins on
numbers. Departures from the spec are recorded in
[`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## Getting started

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

1. **Neon.** Create a project at [neon.tech](https://neon.tech), open
   _Connection Details_, and copy the connection string twice:
   - `DATABASE_URL` — the one whose host contains `-pooler`
   - `DATABASE_URL_UNPOOLED` — the same string with `-pooler` removed

   Both are needed. Request traffic goes through the pooled endpoint; all DDL
   goes through the direct one, because Neon's pooler is PgBouncer in
   transaction mode and is not a reliable place to run schema changes.

2. **Auth secret.** `npx auth secret`, or paste 32 random bytes of base64.

3. **Sign-in.** Either register a GitHub OAuth app and set `AUTH_GITHUB_ID` /
   `AUTH_GITHUB_SECRET`, or leave `AUTH_DEV_LOGIN=1` and use the passwordless
   local button. The local provider is refused in production regardless of how
   the variable is set.

Then:

```bash
npm run db:migrate    # create the schema, roles and RLS policies
npm run db:seed       # region reference data
npm run verify:rls    # confirm tenant isolation is actually in force
npm run dev
```

`verify:rls` should end with `PASS`. If it does not, stop and read what it says
— it is checking the thing that keeps players out of each other's data.

---

## Commands

```bash
npm run dev              # localhost:3000
npm run check            # format + types + lint + unit tests
npm run test:unit        # pure logic. No database needed.
npm run test:integration # real Postgres. PGlite by default; Neon if TEST_DATABASE_URL is set.
npm run verify:rls       # is row-level security in force on the configured database
npm run db:generate      # generate a migration after editing lib/db/schema.ts
npm run db:migrate       # apply migrations
npm run db:seed          # idempotent region seed
npm run db:app-role      # provision the app_user login role (production hardening)
npm run loop             # run the autonomous work loop once
```

---

## Two things worth understanding before changing anything

### Resources are derived, never ticked

There is no cron job advancing Energy or Focus. The database stores a value and
the timestamp that value was last correct at, and the current value is computed
on read (`lib/game/resources.ts`). Close the tab for a week and the numbers will
be exactly what the arithmetic says when you come back.

Two rules carry it, and both are easy to get subtly wrong in ways that pass an
obvious test:

- The stored timestamp advances by **every** whole tick that elapsed, even when
  the value clamps at the cap. Advancing only by the ticks consumed leaves the
  rest of a long absence banked, and it materialises the instant the player
  spends.
- The timestamp is **never** set to `now`. That would discard the fraction of a
  tick already waited through.

Together they pin the timestamp into `(now - regenMs, now]`. This is
`SPEC §7` tests 1 and 2, plus the anti-banking block that neither of them
catches on its own.

### Tenant isolation is enforced by Postgres, not by our `if` statements

Every player-owned table has row-level security enabled **and forced**, and
every request-scoped statement runs after `SET LOCAL ROLE app_user` with the
caller's id injected as `app.user_id` (`lib/db/rls.ts`).

Both halves are needed. Neon's `neondb_owner` holds `BYPASSRLS`, so forcing RLS
alone protects nothing; and the demotion alone is defeated by anyone who forgets
it. `npm run verify:rls` checks the configuration and
`tests/integration/rls.test.ts` checks the behaviour, including the one thing
this design does **not** stop — which is documented rather than assumed away.

---

## The agent harness

This repository is set up to be worked on by Claude Code, largely unattended.

```bash
npm run loop            # one item, end to end, opening a PR
npm run loop -- --n 5   # five items, stopping on the first failure
```

Each pass reads [`BUGTRAQ.md`](BUGTRAQ.md) and [`BACKLOG.md`](BACKLOG.md), takes
the single highest-priority item **belonging to the current phase**, writes the
test first, implements, reviews its own diff with a separate agent, and opens a
pull request. Then it stops. One item per context is deliberate: it bounds how
far a bad run can get.

| Command        | What it does                                         |
| -------------- | ---------------------------------------------------- |
| `/dojo-loop`   | The above, interactively                             |
| `/dojo-bug`    | Reproduce, write a failing test, file it             |
| `/dojo-task`   | Add a backlog item with testable acceptance criteria |
| `/dojo-ship`   | Commit, push, open a reviewable PR                   |
| `/dojo-status` | Phase, open work, CI, database health                |
| `/dojo-phase`  | Close a phase — only after proving its gate          |

Subagents: `spec-guardian`, `test-author`, `db-steward`, `balance-analyst`,
`change-reviewer`, `bug-triager`. See [`CLAUDE.md`](CLAUDE.md).

**On permissions.** `.claude/settings.json` sets `bypassPermissions`, and the
loop runs with `--dangerously-skip-permissions`, because there is nobody at the
keyboard to approve anything. What replaces the prompt is
`.claude/hooks/guard-secrets.mjs`, which blocks force-pushes, direct pushes to
`main`, hard resets, destructive DDL, and anything that would stage or print a
secret — plus branch protection, since every change arrives as a PR and nothing
merges itself. If you would rather have prompts back, change `defaultMode` to
`"acceptEdits"`; the allow-list already covers ordinary work.

---

## Deploying

**Production: <https://dojo.progrowthtech.com>** — Vercel project
`dev-dojo-ascendant` under the `pro-growth-tech` team, deploying from `main`.

The generated `dev-dojo-ascendant.vercel.app` domain redirects to the custom
one. That redirect is not cosmetic: a GitHub OAuth app permits exactly one
callback URL, so every sign-in has to arrive on the same host. See D9 below.

### First-time setup

1. Import the repository on Vercel. It detects Next.js; no `vercel.json` is
   needed.

2. **Attach the domain before creating the OAuth app**, so the callback points
   at a host that answers. Settings → Domains → add `dojo.progrowthtech.com`.
   DNS for `progrowthtech.com` is managed at WordPress.com, where a wildcard
   `*.progrowthtech.com` already points at Vercel — so this usually verifies
   with no DNS change. If Vercel reports _Invalid Configuration_, add a CNAME
   record `dojo` → `cname.vercel-dns.com`.

   Then set the `.vercel.app` domains to redirect to the custom domain.

3. Create a **production** GitHub OAuth app
   ([github.com/settings/developers](https://github.com/settings/developers)):

   | Field                      | Value                                                     |
   | -------------------------- | --------------------------------------------------------- |
   | Homepage URL               | `https://dojo.progrowthtech.com`                          |
   | Authorization callback URL | `https://dojo.progrowthtech.com/api/auth/callback/github` |

   The callback path is derived from the route handler and the provider id — it
   is not configurable. Local development needs a **separate** OAuth app
   pointing at `http://localhost:3000/api/auth/callback/github`, because one app
   holds one callback URL. Or just use `AUTH_DEV_LOGIN=1` locally, which is what
   it exists for.

4. Set environment variables in the Vercel project (Production scope):

   | Variable                                | Value                             |
   | --------------------------------------- | --------------------------------- |
   | `DATABASE_URL`                          | Neon **pooled** connection string |
   | `DATABASE_URL_UNPOOLED`                 | Neon **direct** connection string |
   | `AUTH_SECRET`                           | `npx auth secret`                 |
   | `AUTH_URL`                              | `https://dojo.progrowthtech.com`  |
   | `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | from step 3                       |

   Do **not** set `AUTH_DEV_LOGIN`. The provider is refused in production
   regardless, but leaving it unset avoids the question.

   Vercel bakes environment variables at build time, so **redeploy** after
   changing any of them.

5. Add `DATABASE_URL_UNPOOLED` as a GitHub Actions secret so
   `.github/workflows/migrate.yml` can run migrations on merge to `main`:

   ```bash
   node -e "require('dotenv').config({path:'.env.local'});process.stdout.write(process.env.DATABASE_URL_UNPOOLED)" | gh secret set DATABASE_URL_UNPOOLED
   ```

   Piped rather than pasted, so the value never lands in shell history.

6. Before going public, run `npm run db:app-role` and set `APP_DATABASE_URL` —
   see D4 in [`docs/DECISIONS.md`](docs/DECISIONS.md).

Migrations deliberately do **not** run in the Vercel build command. A build can
be skipped, auto-cancelled, or rolled back independently of the schema, and any
of those leaves code and database disagreeing while the deploy reports success.

### Preview deployments

Previews get a unique URL per deployment, which can never match the single
registered callback URL, so **GitHub sign-in does not work on a preview**. That
is a property of OAuth apps, not a misconfiguration. Previews are still useful
for everything that does not require signing in.

---

## Licence

Unlicensed / all rights reserved. Personal project.
