'use client';

import { parseFieldPath } from '@cv/shared';
import { ChevronRightIcon } from 'lucide-react';
import { Fragment } from 'react';
import { useWatch } from 'react-hook-form';

import { questionLocation } from '@/lib/question-location';
import { useEditor } from './editor-context';

/** Where a question points ("Experience › Acme — Engineer › Dates"), kept current as you edit. */
export function QuestionLocation({ path }: { path: string }) {
  const { form } = useEditor();
  const section = parseFieldPath(path)?.section ?? 'summary';
  // Only the question's own section: an edit elsewhere does not re-render the card.
  const value = useWatch({ control: form.control, name: section });
  const steps = questionLocation(path, { [section]: value });
  if (steps.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
      {steps.map((step, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRightIcon className="size-3 shrink-0" aria-hidden />}
          <span className={i === steps.length - 1 ? 'font-medium text-foreground' : undefined}>
            {step}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
