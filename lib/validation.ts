/**
 * Input schemas. Shared by the client form and the server action, so the two
 * cannot drift — but the server one is the only one that counts.
 */

import { z } from 'zod';

import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  HANDLE_PATTERN,
  NATIONALITIES,
} from '@/lib/constants';

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(HANDLE_MIN_LENGTH, `At least ${HANDLE_MIN_LENGTH} characters.`)
  .max(HANDLE_MAX_LENGTH, `At most ${HANDLE_MAX_LENGTH} characters.`)
  .regex(HANDLE_PATTERN, 'Lowercase letters, numbers and underscores only.');

const displayName = (label: string) =>
  z
    .string()
    .trim()
    .min(DISPLAY_NAME_MIN_LENGTH, `${label} is too short.`)
    .max(DISPLAY_NAME_MAX_LENGTH, `${label} is too long.`);

export const createDojoSchema = z.object({
  handle: handleSchema,
  headmasterName: displayName('Your name'),
  dojoName: displayName('The dojo name'),
  nationality: z.enum(NATIONALITIES),
  regionSlug: z.string().trim().min(1, 'Choose a region.'),
});

export type CreateDojoInput = z.infer<typeof createDojoSchema>;

/** Flatten a ZodError into `{ field: message }` for rendering next to inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}
