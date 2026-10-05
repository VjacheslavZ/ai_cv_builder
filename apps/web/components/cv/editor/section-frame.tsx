'use client';

import { isFieldPathWithin } from '@cv/shared';
import { cn } from 'cn';
import { LoaderCircleIcon } from 'lucide-react';

import { questionAnchorId } from '@/lib/question-marks';
import { useEditor } from './editor-context';

interface SectionFrameProps {
  /** The field path of this section or entry (the anchor questions scroll to). */
  path: string;
  title?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * A section or entry of the editor: highlighted when an open question points at it (AC-8.1),
 * "Updating…" while the AI rewrites it (AC-9.4), and briefly highlighted after it did (AC-9.1).
 */
export function SectionFrame({ path, title, className, children }: SectionFrameProps) {
  const { marks, lockedScopes, flashed } = useEditor();
  const marked = marks.at(path);
  const updating = lockedScopes.some((scope) => isFieldPathWithin(path, scope));
  const flash = flashed.some((scope) => isFieldPathWithin(path, scope));
  const Heading = title ? 'h3' : null;
  // A titled section is a top-level block of the form: a white card on the gray page.
  const card = Boolean(title);

  return (
    <section
      id={questionAnchorId(path)}
      aria-busy={updating || undefined}
      className={cn(
        'relative flex scroll-mt-20 flex-col gap-3 rounded-lg transition-colors duration-700',
        card && 'border bg-card p-4',
        marked &&
          (card
            ? 'bg-amber-50 ring-1 ring-amber-500/50 dark:bg-amber-500/10'
            : '-mx-2 bg-amber-500/10 px-2 py-2 ring-1 ring-amber-500/50'),
        flash &&
          (card
            ? 'bg-emerald-50 ring-1 ring-emerald-500/50 dark:bg-emerald-500/15'
            : '-mx-2 bg-emerald-500/15 px-2 py-2 ring-1 ring-emerald-500/50'),
        className,
      )}
    >
      {(Heading || updating) && (
        <div className="flex items-center justify-between gap-2">
          {Heading && (
            <Heading className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {title}
            </Heading>
          )}
          {updating && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircleIcon
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
              Updating…
            </span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/** A field with a question anchor of its own (`contact.phone`, `experience.<id>.dates`). */
export function FieldAnchor({ path, children }: { path: string; children: React.ReactNode }) {
  const { marks } = useEditor();
  return (
    <div
      id={questionAnchorId(path)}
      className={cn(
        'min-w-0 scroll-mt-20 rounded-md',
        marks.at(path) && '-mx-1.5 bg-amber-500/10 px-1.5 py-1 ring-1 ring-amber-500/50',
      )}
    >
      {children}
    </div>
  );
}
