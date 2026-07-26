import { redirect } from 'next/navigation';

import { currentUserId } from '@/auth';
import { signOutAction } from '@/lib/actions/auth';
import { CreateDojoForm } from '@/components/CreateDojoForm';
import { hasPlayer, listStartingRegions } from '@/lib/repo/dojo';

export const metadata = { title: 'Found a dojo — Dojo Ascendant' };

export default async function CreatePage() {
  const userId = await currentUserId();
  if (!userId) redirect('/');
  if (await hasPlayer(userId)) redirect('/dojo');

  const regions = await listStartingRegions();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <p className="font-mono text-xs tracking-[0.3em] text-cinnabar-400 uppercase">
        Found your school
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-ink-100">
        Everything after this grows from here.
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-300">
        Your nationality sets which scroll family you begin with. It does not lock your style — that
        crystallises later, out of what you actually teach.
      </p>

      <CreateDojoForm
        regions={regions.map((region) => ({
          slug: region.slug,
          name: region.name,
          description: region.description,
          recruitQuality: region.recruitQuality,
          scrollFamilies: region.scrollFamilies,
        }))}
      />

      {/*
        The only other sign-out control lives on /dojo, which redirects here
        when there is no dojo — and / redirects here too. That made this page
        a dead end: signing in with the wrong account left no way back except
        clearing cookies. The action's own copy even advises "try signing out",
        advice that was unreachable from the page showing it.
      */}
      <div className="mt-10 border-t border-ink-800 pt-6">
        <form action={signOutAction}>
          <button
            type="submit"
            className="cursor-pointer text-xs text-ink-400 underline underline-offset-4 transition hover:text-ink-200"
          >
            Sign in as someone else
          </button>
        </form>
      </div>
    </main>
  );
}
