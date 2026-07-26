---
name: auth-js-still-beta
description: next-auth v5 is still beta as of July 2026; pinned exactly, with JWT sessions to keep a passwordless local login.
metadata:
  type: project
---

As of 2026-07-25, `next-auth` publishes `latest` as 4.24.15 and v5 only as
`beta` (5.0.0-beta.32). v5 is nonetheless the standard App Router path, so it is
what this project uses — pinned to an exact version rather than a range, because
a beta range is not a stable dependency.

Session strategy is **JWT**, not database sessions, even though the Drizzle
adapter is present and does persist users and linked accounts.

**Why:** database sessions are mutually exclusive with the Credentials provider,
and Credentials is what powers the local sign-in button that lets the game run
without first registering a GitHub OAuth app. The cost is no server-side session
revocation — acceptable for a game at Phase 1, worth revisiting before launch.

**How to apply:** the identity the entire RLS layer trusts is
`session.user.id`, which is the `users.id` uuid carried on `token.sub`. Nothing
else may ever be used as identity — not a form field, not a query parameter.
When bumping the beta, re-check that the `jwt` and `session` callbacks still
populate that id: everything downstream fails closed if they do not, but it
fails silently.
