import type { QuestionDto, QuestionType } from '@cv/shared';
import { CircleHelpIcon } from 'lucide-react';

import { questionAnchorId } from '@/lib/question-marks';

const TYPE_LABEL: Record<QuestionType, string> = {
  missing: 'Missing',
  vague: 'Needs detail',
  unverified: 'Not verified',
};

function show(path: string) {
  const target = document.getElementById(questionAnchorId(path));
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Open questions next to the draft, most important first (AC-8.1, AC-8.2). Each one jumps to the
 * place it points at. Answering and skipping arrive in Phase 4.
 */
export function QuestionsList({ questions }: { questions: QuestionDto[] }) {
  const open = questions.filter((q) => q.status === 'open');
  return (
    <aside aria-labelledby="questions-heading" className="flex flex-col gap-3">
      <h2 id="questions-heading" className="flex items-center gap-2 text-sm font-semibold">
        <CircleHelpIcon className="size-4" aria-hidden />
        Questions ({open.length})
      </h2>
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open questions. Your draft is complete.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {open.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => show(q.path)}
                className="flex min-h-11 w-full flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  {TYPE_LABEL[q.type]}
                </span>
                <span className="break-words">{q.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">
        Questions never block you: skip any of them and download the CV anyway.
      </p>
    </aside>
  );
}
