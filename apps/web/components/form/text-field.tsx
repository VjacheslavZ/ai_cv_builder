'use client';

import { cn } from 'cn';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export interface TextFieldProps extends Omit<React.ComponentProps<typeof Input>, 'id'> {
  id: string;
  label: string;
  /** A react-hook-form field error (`formState.errors.<name>`). */
  error?: { message?: string };
}

/**
 * Label + input + error message. Spread `form.register(name)` into it. The error is absolutely
 * positioned in the gap below the input, so showing or hiding it never changes the form height;
 * keep fields in a `FieldGroup` with `gap-6` (room for one line of error).
 */
export function TextField({ id, label, error, className, ...inputProps }: TextFieldProps) {
  const errorId = `${id}-error`;
  const invalid = !!error || undefined;

  return (
    <Field data-invalid={invalid} className="relative">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        className={cn('h-10', className)}
        aria-invalid={invalid}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      <FieldError
        id={errorId}
        errors={[error]}
        className="absolute top-full left-0 mt-0.5 w-full truncate text-xs leading-4"
      />
    </Field>
  );
}
