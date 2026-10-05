'use client';

import { fieldValueSchema } from '@cv/shared';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { useEditor, useLocked } from './editor-context';

/** A link is one field (`contact.links.<id>`) with two inputs: saved when both are valid. */
export function LinkField({ index, id }: { index: number; id: string }) {
  const { form, autosave } = useEditor();
  const [error, setError] = useState<string | null>(null);
  const path = `contact.links.${id}`;
  const locked = useLocked(path);

  const save = () => {
    const parsed = fieldValueSchema(path)?.safeParse(form.getValues(`contact.links.${index}`));
    if (!parsed) return;
    setError(parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Invalid link'));
    if (parsed.success) {
      const { label, url } = parsed.data as { label: string; url: string };
      autosave.set(path, { label, url });
    }
  };
  const field = (key: 'label' | 'url') =>
    form.register(`contact.links.${index}.${key}`, {
      onChange: save,
      onBlur: () => autosave.flush(),
    });

  return (
    <div className="flex flex-col gap-1">
      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Input
          aria-label="Link label"
          placeholder="Label"
          className="h-11 text-base"
          readOnly={locked}
          {...field('label')}
        />
        <Input
          aria-label="Link URL"
          placeholder="https://"
          inputMode="url"
          autoComplete="url"
          className="h-11 text-base"
          readOnly={locked}
          aria-invalid={error ? true : undefined}
          {...field('url')}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
