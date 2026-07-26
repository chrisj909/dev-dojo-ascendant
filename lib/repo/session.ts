/**
 * Session sanity checks. Server-only.
 *
 * Sessions are JWTs (docs/DECISIONS.md D6), so a signed token remains valid
 * after the `users` row it names has been deleted. Nothing in the token itself
 * can reveal that; only the database can.
 *
 * Left unhandled this produces a dead end rather than an error: the landing
 * page sees a signed-in user, routes them to onboarding, and every write there
 * fails on a foreign key. That happened, and the symptom reaching the player
 * was a form that blanked itself and said nothing.
 */

import 'server-only';

import { eq } from 'drizzle-orm';

import { ownerDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';

/**
 * Whether the auth user named by the session still exists.
 *
 * Uses the owner connection deliberately: `app_user` has every privilege on
 * `users` revoked (drizzle/0001_rls.sql), so request-scoped code cannot answer
 * this question at all. It is a single primary-key lookup.
 */
export async function authUserExists(userId: string): Promise<boolean> {
  const rows = await ownerDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows.length > 0;
}
