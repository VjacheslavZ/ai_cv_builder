'use client';

import { SOURCE_TEXT_MAX_LENGTH } from '@cv/shared';
import { useWatch, type Control, type UseFormRegisterReturn } from 'react-hook-form';

import { Textarea } from '@/components/ui/textarea';
import type { NewCvValues } from '@/lib/create-cv-errors';

/** Subscribes to `text` on its own, so typing re-renders only this counter, not the form. */
function TextLength({ control }: { control: Control<NewCvValues> }) {
  const text = useWatch({ control, name: 'text' });
  return (
    <p className="mt-1 text-right text-xs text-muted-foreground">
      {text.length.toLocaleString('en-US')} / {SOURCE_TEXT_MAX_LENGTH.toLocaleString('en-US')}
    </p>
  );
}

interface SourceTextFieldProps {
  control: Control<NewCvValues>;
  invalid: boolean;
  registration: UseFormRegisterReturn<'text'>;
}

/** The "Paste text" tab: the user's experience as free text, with a character counter. */
export function SourceTextField({ control, invalid, registration }: SourceTextFieldProps) {
  return (
    <>
      <Textarea
        id="text"
        aria-label="Your experience as text"
        placeholder="Paste your work history, education, and skills"
        className="min-h-48"
        aria-invalid={invalid || undefined}
        {...registration}
      />
      <TextLength control={control} />
    </>
  );
}
