'use client';

import { useSyncExternalStore } from 'react';

import { msUntilFull, msUntilNext, regenerate } from '@/lib/game/resources';
import type { ResourceView } from '@/lib/repo/dojo';

/**
 * A bar that actually ticks — SPEC §6 Phase 1, "one screen showing bars that
 * actually tick".
 *
 * The client re-derives the value with THE SAME pure function the server used,
 * from the same stored timestamp. It is not counting up independently and it is
 * not polling; it is recomputing a value that was always a function of the
 * clock. A refresh can therefore never disagree with what was on screen, and an
 * hour in a background tab costs nothing.
 */

/**
 * The wall clock, rounded to the second, as a React data source.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` because the clock
 * genuinely is an external store, and because the server snapshot is a separate
 * function: SSR and the hydrating render both read `null` and fall back to the
 * server's numbers, so the first paint cannot disagree with the HTML. Reading
 * `Date.now()` during render would guarantee a hydration mismatch in the one
 * component whose whole job is to show a moving number.
 *
 * The snapshot is floored to the second so React sees a stable value between
 * renders within the same tick.
 */
function useClock(): number | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      const id = setInterval(onStoreChange, 1000);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / 1000) * 1000,
    () => null,
  );
}

type Props = {
  label: string;
  view: ResourceView;
  tone: 'energy' | 'focus';
  hint: string;
};

const TONE = {
  energy: {
    fill: 'bg-jade-500',
    text: 'text-jade-400',
    track: 'bg-jade-500/10',
  },
  focus: {
    fill: 'bg-cinnabar-500',
    text: 'text-cinnabar-400',
    track: 'bg-cinnabar-500/10',
  },
} as const;

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function ResourceBar({ label, view, tone, hint }: Props) {
  const tick = useClock();
  const now = tick === null ? null : new Date(tick);

  const stored = { value: view.value, updatedAt: new Date(view.updatedAt) };
  const spec = { regenMs: view.regenMs, cap: view.cap };

  // Before mount, render exactly what the server computed.
  const current = now ? regenerate(stored, now, spec) : stored;
  const nextIn = now ? msUntilNext(stored, now, spec) : view.msUntilNext;
  const fullIn = now ? msUntilFull(stored, now, spec) : view.msUntilFull;

  const percent = spec.cap === 0 ? 100 : Math.round((current.value / spec.cap) * 100);
  const full = current.value >= spec.cap;
  const palette = TONE[tone];

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-medium tracking-wide text-ink-200 uppercase">{label}</h3>
          <span className="text-xs text-ink-400">{hint}</span>
        </div>
        <p className="font-mono text-sm tabular-nums">
          <span className={palette.text}>{current.value}</span>
          <span className="text-ink-400"> / {spec.cap}</span>
        </p>
      </div>

      <div
        className={`mt-3 h-2 w-full overflow-hidden rounded-full ${palette.track}`}
        role="progressbar"
        aria-valuenow={current.value}
        aria-valuemin={0}
        aria-valuemax={spec.cap}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${palette.fill}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="mt-2 font-mono text-xs text-ink-400 tabular-nums">
        {full ? (
          <span>full — nothing accruing</span>
        ) : (
          <>
            <span>+1 in {nextIn === null ? '—' : formatDuration(nextIn)}</span>
            {fullIn !== null && (
              <span className="text-ink-600"> · full in {formatDuration(fullIn)}</span>
            )}
          </>
        )}
      </p>
    </div>
  );
}
