import { cn } from 'cn';
import { CircleHelpIcon } from 'lucide-react';

import { questionAnchorId, type QuestionMarks } from '@/lib/question-marks';

interface MarkedProps {
  path: string;
  marks: QuestionMarks;
  className?: string;
  children: React.ReactNode;
}

/**
 * A place in the CV, highlighted when an open question points at it (AC-8.1). Carries the
 * anchor the questions list scrolls to.
 */
export function Marked({ path, marks, className, children }: MarkedProps) {
  const marked = marks.at(path);
  return (
    <div
      id={questionAnchorId(path)}
      className={cn(
        'scroll-mt-20 rounded-md',
        marked && '-mx-1.5 bg-amber-500/10 px-1.5 ring-1 ring-amber-500/50',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** An empty place with a question: shown so the user sees where the answer will go. */
export function Missing({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground italic">
      <CircleHelpIcon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </p>
  );
}

export function Section({
  title,
  path,
  marks,
  children,
}: {
  title: string;
  path: string;
  marks: QuestionMarks;
  children: React.ReactNode;
}) {
  return (
    <Marked path={path} marks={marks} className="flex flex-col gap-2 py-0.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </Marked>
  );
}
