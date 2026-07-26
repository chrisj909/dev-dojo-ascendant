'use server';

/**
 * Server actions for Phase 1.
 *
 * SPEC §2.2: the client sends intent, never outcomes. These take form input,
 * decide everything server-side, and return only what the UI needs to render.
 * Identity comes from the session — never from the payload.
 *
 * STRUCTURE, AND WHY IT IS THIS SHAPE
 *
 * Next.js implements `redirect()` by throwing. A redirect inside a `try` with a
 * broad `catch` is therefore swallowed, and the user sits on a page that
 * silently did nothing. Every redirect below is outside every try block, and
 * that is load-bearing rather than stylistic.
 *
 * Every failure path returns a message. A previous version let an unrecognised
 * database error fall through as a bare rejection, which reached the user as a
 * cleared form and no explanation at all.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { currentUserId, signOut } from '@/auth';
import { createPlayerAndDojo, findDojoState, type CreateDojoResult } from '@/lib/repo/dojo';
import { createDojoSchema, fieldErrors } from '@/lib/validation';

export type CreateDojoState = {
  errors?: Record<string, string>;
  message?: string;
};

export async function createDojoAction(
  _previous: CreateDojoState,
  formData: FormData,
): Promise<CreateDojoState> {
  const userId = await currentUserId();
  if (!userId) redirect('/');

  const parsed = createDojoSchema.safeParse({
    handle: formData.get('handle'),
    headmasterName: formData.get('headmasterName'),
    dojoName: formData.get('dojoName'),
    nationality: formData.get('nationality'),
    regionSlug: formData.get('regionSlug'),
  });

  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error) };
  }

  const now = new Date();
  let result: CreateDojoResult;

  try {
    result = await createPlayerAndDojo(
      userId,
      {
        handle: parsed.data.handle,
        headmasterName: parsed.data.headmasterName,
        nationality: parsed.data.nationality,
        dojoName: parsed.data.dojoName,
        regionSlug: parsed.data.regionSlug,
      },
      now,
    );
  } catch (error) {
    // The repository classifies what it recognises and returns it. Reaching
    // here means something outside that vocabulary went wrong — a dropped
    // connection, most likely. Say so; never return silently.
    console.error('[createDojoAction] unexpected failure', error);
    return {
      message: 'Could not reach the database. Nothing was created — try again in a moment.',
    };
  }

  if (result.ok) {
    revalidatePath('/dojo');
    redirect('/dojo'); // outside every try, deliberately
  }

  switch (result.reason) {
    case 'handle_taken':
      return { errors: { handle: 'That handle is taken.' } };

    case 'unknown_region':
      return {
        errors: { regionSlug: 'That region is not open to new dojos. Pick another.' },
      };

    case 'stale_session':
      // A valid signed token naming a `users` row that no longer exists.
      // Redirecting alone is not enough: the token stays valid, so the landing
      // page would treat them as signed in and route them straight back here.
      // The cookie has to go. signOut() performs the redirect itself.
      await signOut({ redirectTo: '/?reason=session-expired' });
      break;

    case 'already_exists':
      break;

    case 'unexpected':
      return {
        message:
          'Something went wrong creating the dojo, and nothing was saved. If it happens again, please report it.',
      };
  }

  // 'already_exists' only. Confirm the dojo really is there before sending them
  // to it: redirecting on trust is how a misclassified error turned into a loop
  // between /create and /dojo with the form blanking each time.
  const existing = await findDojoState(userId, now).catch(() => null);
  if (existing) {
    revalidatePath('/dojo');
    redirect('/dojo');
  }

  return {
    message:
      'That account already has a dojo, but it could not be loaded. Try signing out and back in.',
  };
}
