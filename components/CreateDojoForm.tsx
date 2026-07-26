'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { createDojoAction, type CreateDojoState } from '@/lib/actions/onboarding';
import { NATIONALITIES } from '@/lib/constants';

type RegionOption = {
  slug: string;
  name: string;
  description: string;
  recruitQuality: number;
  scrollFamilies: string[];
};

const INITIAL: CreateDojoState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full cursor-pointer rounded-md bg-cinnabar-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-cinnabar-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cinnabar-300 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Opening the doors…' : 'Open the dojo'}
    </button>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-200">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-400">{hint}</span>}
      <div className="mt-2">{children}</div>
      {error && <p className="mt-1.5 text-xs text-cinnabar-300">{error}</p>}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600 focus:border-cinnabar-400 focus:outline-none';

export function CreateDojoForm({ regions }: { regions: RegionOption[] }) {
  const [state, formAction] = useActionState(createDojoAction, INITIAL);
  const errors = state.errors ?? {};
  const errorRef = useRef<HTMLParagraphElement>(null);

  // What the player typed, echoed back by the action. React 19 resets an
  // uncontrolled `<form action={fn}>` on every dispatch, so without re-seeding
  // the defaults from this the form empties itself on every error.
  const values = state.values ?? {};
  const hasFieldErrors = Object.keys(errors).length > 0;
  const alert =
    state.message ?? (hasFieldErrors ? 'Check the highlighted fields and try again.' : null);

  // Keyed on the nonce, not the text: submitting twice and getting the identical
  // message must still move focus and re-announce. Without a signal here, a
  // failed submit is indistinguishable from nothing happening — which is exactly
  // how this bug was reported.
  useEffect(() => {
    if (state.nonce) errorRef.current?.focus();
  }, [state.nonce]);

  return (
    <form action={formAction} className="mt-10 space-y-6">
      <Field
        label="Handle"
        hint="How rivals will see you. Cannot be changed."
        error={errors.handle}
      >
        <input
          name="handle"
          required
          defaultValue={values.handle ?? ''}
          autoComplete="off"
          spellCheck={false}
          placeholder="iron_crane"
          className={`${inputClass} font-mono`}
        />
      </Field>

      <Field label="Your name" hint="The headmaster." error={errors.headmasterName}>
        <input
          name="headmasterName"
          required
          defaultValue={values.headmasterName ?? ''}
          autoComplete="off"
          placeholder="Tomoe Sasaki"
          className={inputClass}
        />
      </Field>

      <Field
        label="Nationality"
        hint="Sets your starting scroll lineage."
        error={errors.nationality}
      >
        <select
          // Keyed so a changed echo remounts the select. React applies
          // `defaultValue` to a <select> on mount only, so without this the
          // nationality is the one field the reset still wipes.
          key={`nationality-${values.nationality ?? ''}`}
          name="nationality"
          required
          defaultValue={values.nationality ?? ''}
          className={inputClass}
        >
          <option value="" disabled>
            Choose…
          </option>
          {NATIONALITIES.map((nationality) => (
            <option key={nationality} value={nationality}>
              {nationality}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Dojo name" error={errors.dojoName}>
        <input
          name="dojoName"
          required
          defaultValue={values.dojoName ?? ''}
          autoComplete="off"
          placeholder="The Low Gate"
          className={inputClass}
        />
      </Field>

      <fieldset>
        <legend className="text-sm font-medium text-ink-200">Region</legend>
        <p className="mt-0.5 text-xs text-ink-400">
          Sets recruit quality and which scroll families drop for you. You can expand later.
        </p>
        <div className="mt-3 space-y-2">
          {regions.map((region, index) => (
            <label
              key={region.slug}
              className="flex cursor-pointer gap-3 rounded-md border border-ink-800 bg-ink-900 p-3 transition hover:border-ink-700 has-checked:border-cinnabar-500 has-checked:bg-cinnabar-500/5"
            >
              <input
                type="radio"
                name="regionSlug"
                value={region.slug}
                defaultChecked={values.regionSlug ? values.regionSlug === region.slug : index === 0}
                required
                className="mt-1 accent-cinnabar-500"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink-100">{region.name}</span>
                  <span className="font-mono text-xs text-ink-400">
                    recruits {region.recruitQuality}/5
                  </span>
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-ink-300">
                  {region.description}
                </span>
                <span className="mt-1.5 block font-mono text-[11px] text-ink-600">
                  {region.scrollFamilies.map((f) => f.replace(/_/g, ' ')).join(' · ')}
                </span>
              </span>
            </label>
          ))}
        </div>
        {errors.regionSlug && (
          <p className="mt-1.5 text-xs text-cinnabar-300">{errors.regionSlug}</p>
        )}
      </fieldset>

      {alert && (
        // role=alert so a screen reader announces it, and tabIndex so the focus
        // move below can land here. A failed submit that says nothing is the
        // bug this exists to prevent.
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-cinnabar-500/30 bg-cinnabar-500/5 p-3 text-sm text-cinnabar-300 outline-none"
        >
          {alert}
        </p>
      )}

      <Submit />
    </form>
  );
}
