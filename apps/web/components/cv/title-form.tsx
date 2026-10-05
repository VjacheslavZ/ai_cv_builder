'use client';

import { renameCvSchema, TITLE_MAX_LENGTH } from '@cv/shared';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiRequestError } from '@/lib/api-fetch';
import { useRenameCv } from './use-rename-cv';

interface TitleFormProps {
  cvId: string;
  title: string;
  /** Called after a save or a cancel. */
  onDone(): void;
}

function errorText(error: unknown): string {
  if (error instanceof ApiRequestError) return error.fields?.title ?? error.message;
  return 'Could not rename the CV. Try again.';
}

/**
 * Inline rename (AC-12.4): Enter or "Save" saves, Escape or "Cancel" leaves the title as it
 * was. The same 1–100 character rule as the API (`renameCvSchema`).
 */
export function TitleForm({ cvId, title, onDone }: TitleFormProps) {
  const [value, setValue] = useState(title);
  const [invalid, setInvalid] = useState<string | null>(null);
  const rename = useRenameCv(cvId);
  const errorId = useId();
  const error = invalid ?? (rename.error ? errorText(rename.error) : null);

  const save = () => {
    const parsed = renameCvSchema.safeParse({ title: value });
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]!.message);
      return;
    }
    if (parsed.data.title === title) return onDone();
    rename.mutate(parsed.data.title, { onSuccess: onDone });
  };

  return (
    <form
      noValidate
      className="flex min-w-0 flex-1 flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          autoFocus
          aria-label="CV title"
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          maxLength={TITLE_MAX_LENGTH}
          value={value}
          disabled={rename.isPending}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(null);
            rename.reset();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onDone();
          }}
          className="h-11 min-w-48 flex-1 text-base sm:h-9"
        />
        <Button type="submit" className="h-11 sm:h-9" disabled={rename.isPending}>
          {rename.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <div className="relative">
        {error && (
          <p id={errorId} className="text-sm text-destructive absolute -bottom-15px">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
