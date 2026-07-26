'use server';

import { signIn, signOut } from '@/auth';

export async function signInWithGitHub() {
  await signIn('github', { redirectTo: '/dojo' });
}

/** Local development only — the provider is not registered in production. */
export async function signInLocally() {
  await signIn('dev-login', { redirectTo: '/dojo' });
}

export async function signOutAction() {
  await signOut({ redirectTo: '/' });
}
