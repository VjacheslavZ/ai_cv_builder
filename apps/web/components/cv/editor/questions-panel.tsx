'use client';

import type { AnswerResponse, QuestionDto } from '@cv/shared';
import { CircleHelpIcon } from 'lucide-react';

import { QuestionCard } from './question-card';

/** Questions the user can still act on: open, being applied, or failed (AC-8.6). */
export function activeQuestions(questions: QuestionDto[]): QuestionDto[] {
  return questions
    .filter((q) => q.status === 'open' || q.status === 'applying' || q.status === 'failed')
    .sort((a, b) => a.priority - b.priority);
}

interface QuestionsPanelProps {
  cvId: string;
  questions: QuestionDto[];
  onAnswered(question: QuestionDto, result: AnswerResponse): void;
  onDismissed(question: QuestionDto): void;
}

/** Next to the editor on desktop, a tab of its own on phones (NFR-M2). */
export function QuestionsPanel({ cvId, questions, onAnswered, onDismissed }: QuestionsPanelProps) {
  const active = activeQuestions(questions);
  const open = active.filter((q) => q.status === 'open').length;
  return (
    <aside aria-labelledby="questions-heading" className="flex flex-col gap-3">
      <h2 id="questions-heading" className="flex items-center gap-2 text-sm font-semibold">
        <CircleHelpIcon className="size-4" aria-hidden />
        Questions ({open})
      </h2>
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open questions. Your CV is complete.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {active.map((q) => (
            <QuestionCard
              key={q.id}
              cvId={cvId}
              question={q}
              onAnswered={onAnswered}
              onDismissed={onDismissed}
            />
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">
        Questions never block you: skip any of them and download the CV anyway.
      </p>
    </aside>
  );
}
