import { redirect } from 'next/navigation';

import { currentUserId } from '@/auth';
import { ResourceBar } from '@/components/ResourceBar';
import { signOutAction } from '@/lib/actions/auth';
import { ROSTER_CAP_BY_TIER, TIER_NAMES } from '@/lib/constants';
import { findDojoState } from '@/lib/repo/dojo';

export const metadata = { title: 'Your dojo — Dojo Ascendant' };

// Resources are a function of the clock, so a cached render is a wrong render.
export const dynamic = 'force-dynamic';

export default async function DojoPage() {
  const userId = await currentUserId();
  if (!userId) redirect('/');

  const state = await findDojoState(userId, new Date());
  if (!state) redirect('/create');

  const { player, dojo } = state;
  const tierName = TIER_NAMES[dojo.tier] ?? TIER_NAMES[0];
  const rosterCap = ROSTER_CAP_BY_TIER[dojo.tier] ?? ROSTER_CAP_BY_TIER[0];
  const shielded = dojo.shieldUntil ? new Date(dojo.shieldUntil) > new Date() : false;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs tracking-[0.2em] text-cinnabar-400 uppercase">
            {tierName}
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold text-ink-100">{dojo.name}</h1>
          <p className="mt-1 text-sm text-ink-400">
            {player.headmasterName} · {player.nationality} · {dojo.region.name}
          </p>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="cursor-pointer rounded-md border border-ink-800 px-3 py-1.5 text-xs text-ink-400 transition hover:border-ink-700 hover:text-ink-200"
          >
            Sign out
          </button>
        </form>
      </header>

      {shielded && (
        <p className="mt-6 rounded-md border border-jade-500/25 bg-jade-500/5 px-3 py-2 text-xs text-jade-400">
          Under new-school protection. No rival may challenge you yet.
        </p>
      )}

      <section className="mt-8 grid gap-3 sm:grid-cols-2">
        <ResourceBar label="Energy" view={dojo.energy} tone="energy" hint="drills" />
        <ResourceBar label="Focus" view={dojo.focus} tone="focus" hint="scouting & challenges" />
      </section>

      <section className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tuition" value={dojo.tuition.toLocaleString()} />
        <Stat label="Reputation" value={String(dojo.reputation)} />
        <Stat label="Roster" value={`0 / ${rosterCap}`} />
        <Stat label="Handle" value={player.handle} mono />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium tracking-wide text-ink-200 uppercase">The headmaster</h2>
        <p className="mt-1 text-xs text-ink-400">
          Teaching multipliers. These rise from graduations, not from drills — you learn by
          teaching.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Attribute name="Technique" value={player.technique} note="XP per Energy" />
          <Attribute name="Mental" value={player.mental} note="loyalty defence" />
          <Attribute name="Presence" value={player.presence} note="recruit quality" />
          <Attribute name="Stamina" value={player.stamina} note="Energy & Focus caps" />
          <Attribute name="Discipline" value={player.discipline} note="injury reduction" />
        </dl>
      </section>

      <section className="mt-10 rounded-lg border border-dashed border-ink-800 p-5">
        <h2 className="text-sm font-medium text-ink-200">The mat is empty.</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-400">
          Recruitment, drills and curricula arrive in Phase 2. For now, Energy and Focus accrue
          against the clock whether this page is open or not — close the tab, come back tomorrow,
          and the numbers will be exactly where the arithmetic says they should be.
        </p>
      </section>
    </main>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2.5">
      <dt className="text-[11px] tracking-wide text-ink-400 uppercase">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm text-ink-100 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function Attribute({ name, value, note }: { name: string; value: number; note: string }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2.5">
      <dt className="text-[11px] tracking-wide text-ink-400 uppercase">{name}</dt>
      <dd className="mt-0.5 font-mono text-lg text-ink-100 tabular-nums">{value}</dd>
      <p className="mt-0.5 text-[11px] leading-tight text-ink-300">{note}</p>
    </div>
  );
}
