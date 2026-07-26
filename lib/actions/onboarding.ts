'use server';

/**
 * Server actions for Phase 1.
 *
 * SPEC §2.2: the client sends intent, never outcomes. These take form input,
 * decide everything server-side, and return only what the UI needs to render.
 * Identity comes from the session — never from the payload.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { currentUserId } from '@/auth';
import { createPlayerAndDojo } from '@/lib/repo/dojo';
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

  const result = await createPlayerAndDojo(
    userId,
    {
      handle: parsed.data.handle,
      headmasterName: parsed.data.headmasterName,
      nationality: parsed.data.nationality,
      dojoName: parsed.data.dojoName,
      regionSlug: parsed.data.regionSlug,
    },
    new Date(),
  );

  if (!result.ok) {
    switch (result.reason) {
      case 'handle_taken':
        return { errors: { handle: 'That handle is taken.' } };
      case 'already_exists':
        // Two tabs, or a double submit. The dojo exists either way.
        redirect('/dojo');
      case 'unknown_region':
        return { errors: { regionSlug: 'That region is not open to new dojos.' } };
    }
  }

  revalidatePath('/dojo');
  redirect('/dojo');
}
