import { redirect } from 'next/navigation';

import { currentUserId, devLoginAvailable, githubAvailable } from '@/auth';
import { signInLocally, signInWithGitHub } from '@/lib/actions/auth';
import { hasPlayer } from '@/lib/repo/dojo';

export default async function LandingPage() {
  const userId = await currentUserId();

  if (userId) {
    // Signed in but not onboarded is a real state — the session outlives any
    // half-finished creation flow.
    redirect((await hasPlayer(userId)) ? '/dojo' : '/create');
  }

  const github = githubAvailable();
  const dev = devLoginAvailable();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs tracking-[0.3em] text-cinnabar-400 uppercase">
        Dojo Ascendant
      </p>
      <h1 className="mt-4 text-3xl leading-tight font-semibold text-balance text-ink-100 sm:text-4xl">
        You are a headmaster, not a fighter.
      </h1>
      <p className="mt-5 text-base leading-relaxed text-ink-300">
        Recruit students. Put them through curricula. Raise them to mastery, and when they surpass
        your teaching they leave to found a branch of your school. Your power grows not by
        accumulating fighters, but by accumulating generations.
      </p>

      <div className="mt-10 flex flex-col gap-3">
        {github && (
          <form action={signInWithGitHub}>
            <button
              type="submit"
              className="w-full cursor-pointer rounded-md bg-ink-100 px-4 py-3 text-sm font-medium text-ink-950 transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cinnabar-400"
            >
              Continue with GitHub
            </button>
          </form>
        )}

        {dev && (
          <form action={signInLocally}>
            <button
              type="submit"
              className="w-full cursor-pointer rounded-md border border-ink-700 bg-ink-900 px-4 py-3 text-sm font-medium text-ink-200 transition hover:border-ink-600 hover:bg-ink-850 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cinnabar-400"
            >
              Sign in locally
              <span className="ml-2 font-mono text-xs text-ink-400">development only</span>
            </button>
          </form>
        )}

        {!github && !dev && (
          <div className="rounded-md border border-cinnabar-500/30 bg-cinnabar-500/5 p-4 text-sm text-ink-300">
            <p className="font-medium text-cinnabar-300">No sign-in method is configured.</p>
            <p className="mt-2 leading-relaxed">
              Set <code className="font-mono text-ink-200">AUTH_GITHUB_ID</code> and{' '}
              <code className="font-mono text-ink-200">AUTH_GITHUB_SECRET</code>, or set{' '}
              <code className="font-mono text-ink-200">AUTH_DEV_LOGIN=1</code> for a passwordless
              local sign-in. See <code className="font-mono text-ink-200">.env.example</code>.
            </p>
          </div>
        )}
      </div>

      <p className="mt-12 text-xs leading-relaxed text-ink-600">
        Asynchronous and server-authoritative. No twitch input, no real-time combat. Sessions are
        two minutes or fifteen, never forty.
      </p>
    </main>
  );
}
