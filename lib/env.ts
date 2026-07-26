/**
 * Environment validation. Fails at import time with a readable message rather
 * than at the first query with `undefined is not a connection string`.
 *
 * Server-only. Never import this from a client component.
 */

import { z } from 'zod';

/**
 * Treat an empty string as unset.
 *
 * `.env` files cannot express "absent" — a placeholder line like `AUTH_SECRET=""`
 * produces `''`, which passes an `.optional()` check and then fails a `.min(1)`
 * one. Without this, the template file committed for people to fill in is itself
 * a build failure.
 */
const optionalString = () =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().optional(),
  );

const serverSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required — see .env.example')
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    }),
  /**
   * Direct (non-pooled) connection. Neon's pooled endpoint runs PgBouncer in
   * transaction mode, which is fine for request traffic but cannot run DDL
   * reliably. Migrations use this. Falls back to DATABASE_URL when unset.
   */
  DATABASE_URL_UNPOOLED: optionalString(),
  /**
   * OPTIONAL HARDENING. A connection string for the `app_user` login role,
   * created by `npm run db:app-role`.
   *
   * Without it, request traffic connects as the owner and demotes itself with
   * SET LOCAL ROLE. That enforces every policy, but the demotion is reversible:
   * Postgres authorises SET ROLE against the *session* user, so code able to
   * execute arbitrary SQL could climb back. With it, the session user IS
   * `app_user` and there is nothing to climb back to.
   */
  APP_DATABASE_URL: optionalString(),
  AUTH_SECRET: optionalString(),
  AUTH_GITHUB_ID: optionalString(),
  AUTH_GITHUB_SECRET: optionalString(),
  /**
   * Enables the password-free local sign-in provider. Refused in production
   * regardless of value — see lib/auth.ts.
   */
  AUTH_DEV_LOGIN: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(['0', '1']).optional(),
  ),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment:\n${detail}\n\nCopy .env.example to .env.local and fill it in.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** The connection string used for DDL. Never pooled. */
export function migrationUrl(): string {
  const env = serverEnv();
  return env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** True when the password-free local sign-in provider should be registered. */
export function devLoginEnabled(): boolean {
  return !isProduction() && process.env.AUTH_DEV_LOGIN === '1';
}
