'use client';

import { fieldValueSchema, type CvDocument } from '@cv/shared';
import { cn } from 'cn';
import { useState } from 'react';
import type { FieldPath } from 'react-hook-form';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useEditor, useLocked } from './editor-context';

interface EditableFieldProps {
  /** The react-hook-form name (index-based), e.g. `experience.0.bullets.1.text`. */
  name: FieldPath<CvDocument>;
  /** The field path the server knows (id-based), e.g. `experience.<id>.bullets.<id>`. */
  path: string;
  label: string;
  /** Visible label, or only for screen readers (bullets, skills). */
  hideLabel?: boolean;
  multiline?: boolean;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  type?: string;
  className?: string;
  /** A 44 px control inside the field, at its right edge (a list item's drag handle). */
  endAdornment?: React.ReactNode;
}

/**
 * One text field of the CV (AC-10.1): checked with the field's own schema as you type (an
 * invalid value is never sent: the server would reject the whole batch), queued for autosave,
 * saved at once on blur. Read-only while the AI rewrites its part (AC-9.4).
 */
export function EditableField(props: EditableFieldProps) {
  const { name, path, label, hideLabel, multiline, className, endAdornment, ...inputProps } = props;
  const { form, autosave } = useEditor();
  const [error, setError] = useState<string | null>(null);
  const locked = useLocked(path);
  const id = `field-${path.replaceAll('.', '-')}`;
  const errorId = `${id}-error`;

  const registration = form.register(name, {
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const parsed = fieldValueSchema(path)?.safeParse(event.target.value);
      if (!parsed) return;
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Invalid value');
        return;
      }
      setError(null);
      autosave.set(path, parsed.data);
    },
    onBlur: () => autosave.flush(),
  });

  const shared = {
    id,
    readOnly: locked,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    'aria-busy': locked || undefined,
    ...registration,
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className={cn('text-xs font-medium text-muted-foreground', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <div className="relative">
        {multiline ? (
          <Textarea
            {...shared}
            placeholder={inputProps.placeholder}
            className={cn('min-h-11 text-base', endAdornment && 'pr-11')}
          />
        ) : (
          <Input
            {...shared}
            {...inputProps}
            className={cn('h-11 text-base', endAdornment && 'pr-11')}
          />
        )}
        {endAdornment && <div className="absolute top-0 right-0">{endAdornment}</div>}
      </div>
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
