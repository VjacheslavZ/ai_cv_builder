'use client';

import { fieldValueSchema, type CvDateRange, type CvDocument } from '@cv/shared';
import { useState } from 'react';
import { useController, type FieldPath } from 'react-hook-form';

import { lockingScope, useEditor } from './editor-context';
import { fromDraft, MONTHS, toDraft, type DatesDraft } from '@/lib/dates-draft';

interface DatesFieldProps {
  name: FieldPath<CvDocument>;
  path: string;
}

const selectClass =
  'h-11 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm';
const yearClass = `${selectClass} w-24`;

/**
 * Start and end as month + year, with "Present" for an ongoing job (AC-10.1). Saved once the
 * pair is a valid range (or empty); a half-typed year waits, and blur shows what is wrong.
 */
export function DatesField({ name, path }: DatesFieldProps) {
  const { form, autosave, lockedScopes } = useEditor();
  const { field } = useController({ name, control: form.control });
  const value = field.value as CvDateRange | null;
  const [draft, setDraft] = useState<DatesDraft>(() => toDraft(value));
  const [seen, setSeen] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const locked = !!lockingScope(lockedScopes, path);
  const id = `field-${path.replaceAll('.', '-')}`;

  // The value changed from outside (an AI rewrite, a conflict reload): start from it.
  if (JSON.stringify(seen) !== JSON.stringify(value)) {
    setSeen(value);
    setDraft(toDraft(value));
  }

  function change(patch: Partial<DatesDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    const range = fromDraft(next);
    const parsed = range === undefined ? null : fieldValueSchema(path)?.safeParse(range);
    if (!parsed?.success) return;
    setError(null);
    setSeen(parsed.data as CvDateRange | null);
    field.onChange(parsed.data);
    autosave.set(path, parsed.data);
  }

  function blur() {
    const range = fromDraft(draft);
    const parsed = range === undefined ? null : fieldValueSchema(path)?.safeParse(range);
    setError(parsed?.success ? null : 'Enter a start year, and an end year or Present');
    autosave.flush();
  }

  const part = (end: boolean) => {
    const monthKey = end ? 'endMonth' : 'startMonth';
    const yearKey = end ? 'endYear' : 'startYear';
    const disabled = locked || (end && draft.present);
    return (
      <div className="flex gap-2">
        <select
          aria-label={end ? 'End month' : 'Start month'}
          className={selectClass}
          value={draft[monthKey]}
          disabled={disabled}
          onChange={(e) => change({ [monthKey]: e.target.value })}
          onBlur={blur}
        >
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1).padStart(2, '0')}>
              {m}
            </option>
          ))}
        </select>
        <input
          aria-label={end ? 'End year' : 'Start year'}
          inputMode="numeric"
          placeholder="Year"
          maxLength={4}
          className={yearClass}
          value={draft[yearKey]}
          disabled={disabled}
          onChange={(e) => change({ [yearKey]: e.target.value.replace(/\D/g, '') })}
          onBlur={blur}
        />
      </div>
    );
  };

  return (
    <fieldset
      id={id}
      className="flex flex-col gap-1"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="mb-1 text-xs font-medium text-muted-foreground">Dates</legend>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {part(false)}
        <span aria-hidden>–</span>
        {part(true)}
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={draft.present}
            disabled={locked}
            onChange={(e) => change({ present: e.target.checked })}
          />
          Present
        </label>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
