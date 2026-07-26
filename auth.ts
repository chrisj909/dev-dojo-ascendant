/**
 * Auth.js configuration. SPEC §6 Phase 1 "Auth".
 *
 * SESSION STRATEGY: JWT, with the Drizzle adapter still persisting users and
 * linked accounts.
 *
 * Database sessions would be the more obvious choice, but they are mutually
 * exclusive with the Credentials provider, and Credentials is what powers the
 * local sign-in button that lets the game run without registering a GitHub
 * OAuth app first. JWT keeps both. What it costs is server-side session
 * revocation, which matters for a product handling money and does not matter
 * for a dojo management game at Phase 1. Revisit before launch.
 *
 * The user id in the token is the `users.id` uuid, and it is the value the
 * whole RLS layer trusts (`app.user_id`). Nothing else may be used as identity.
 */

import NextAuth, { type DefaultSession } from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import { eq } from 'drizzle-orm';

import { ownerDb } from '@/lib/db/client';
import { accounts, sessions, users, verificationTokens } from '@/lib/db/schema';
import { devLoginEnabled, isProduction } from '@/lib/env';
import { DEV_LOGIN_EMAIL } from '@/lib/constants';

declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}

function providers() {
  const list = [];

  // Configured via AUTH_GITHUB_ID / AUTH_GITHUB_SECRET, which Auth.js infers.
  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
    list.push(GitHub);
  }

  if (devLoginEnabled()) {
    list.push(
      Credentials({
        id: 'dev-login',
        name: 'Local development',
        credentials: {},
        async authorize() {
          // Belt and braces. `devLoginEnabled()` already refuses in production;
          // this refuses again at the point it would actually mint a session,
          // so a misconfigured NODE_ENV cannot open a passwordless door.
          if (isProduction()) return null;

          const db = ownerDb();
          const existing = await db
            .select()
            .from(users)
            .where(eq(users.email, DEV_LOGIN_EMAIL))
            .limit(1);
          if (existing.length > 0) {
            return { id: existing[0].id, email: existing[0].email, name: existing[0].name };
          }

          const [created] = await db
            .insert(users)
            .values({ email: DEV_LOGIN_EMAIL, name: 'Local Headmaster' })
            .returning();
          return { id: created.id, email: created.email, name: created.name };
        },
      }),
    );
  }

  return list;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(ownerDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'jwt' },
  providers: providers(),
  pages: {
    signIn: '/',
  },
  callbacks: {
    jwt({ token, user }) {
      // `user` is only present on the sign-in pass. Persist the uuid, because
      // `token.sub` is what the session callback hands to the RLS layer.
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});

/**
 * The signed-in user's id, or null.
 *
 * Every caller that reaches the database must pass this to `withPlayer()`.
 * Never derive identity from a request body, a query parameter, or a client
 * component prop.
 */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** True when the local sign-in button should be rendered. */
export function devLoginAvailable(): boolean {
  return devLoginEnabled();
}

/** True when a GitHub OAuth app is configured. */
export function githubAvailable(): boolean {
  return Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
}
