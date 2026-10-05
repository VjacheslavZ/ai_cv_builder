'use client';

import {
  ANSWER_MAX_LENGTH,
  isSimpleField,
  type AnswerResponse,
  type QuestionDto,
  type QuestionType,
} from '@cv/shared';
import { useMutation } from '@tanstack/react-query';
import { LoaderCircleIcon } from 'lucide-react';
import { memo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiRequestError } from '@/lib/api-fetch';
import { answerQuestion, dismissQuestion } from '@/lib/queries/editing';
import { questionAnchorId } from '@/lib/question-marks';
import { QuestionLocation } from './question-location';

const TYPE_LABEL: Record<QuestionType, string> = {
  missing: 'Missing',
  vague: 'Needs detail',
  unverified: 'Not verified',
};

interface QuestionCardProps {
  cvId: string;
  question: QuestionDto;
  onAnswered(question: QuestionDto, result: AnswerResponse): void;
  onDismissed(question: QuestionDto): void;
}

function show(path: string) {
  const target = document.getElementById(questionAnchorId(path));
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target?.querySelector<HTMLElement>('input, textarea, select')?.focus({ preventScroll: true });
}

const errorText = (error: unknown) =>
  error instanceof ApiRequestError
    ? (error.fields?.answer ?? error.message)
    : 'Something went wrong. Try again.';

/** One question: answer, skip, or retry a failed answer (AC-8.4, AC-8.5, AC-9.5). */
export const QuestionCard = memo(function QuestionCard({
  cvId,
  question,
  onAnswered,
  onDismissed,
}: QuestionCardProps) {
  const [answer, setAnswer] = useState('');
  const id = `answer-${question.id}`;
  const send = useMutation({
    mutationFn: (text: string) => answerQuestion(cvId, question.id, text),
    onSuccess: (result) => {
      setAnswer('');
      onAnswered(question, result);
    },
  });
  const skip = useMutation({
    mutationFn: () => dismissQuestion(cvId, question.id),
    onSuccess: () => onDismissed(question),
  });
  const busy = send.isPending || skip.isPending;
  const error = send.error ?? skip.error;

  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      <button
        type="button"
        onClick={() => show(question.path)}
        className="flex min-h-11 flex-col items-start gap-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <QuestionLocation path={question.path} />
        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
          {TYPE_LABEL[question.type]}
        </span>
        <span className="break-words">{question.text}</span>
      </button>

      {question.status === 'applying' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <LoaderCircleIcon
            className="size-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
          Updating your CV with this answer…
        </p>
      )}

      {question.status === 'failed' && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-destructive">Your answer could not be applied. It is saved.</p>
          <div className="flex gap-2">
            <Button
              className="h-11 sm:h-9"
              disabled={busy || !question.answer}
              onClick={() => question.answer && send.mutate(question.answer)}
            >
              Retry
            </Button>
            <Button
              variant="ghost"
              className="h-11 sm:h-9"
              disabled={busy}
              onClick={() => skip.mutate()}
            >
              Skip
            </Button>
          </div>
        </div>
      )}

      {question.status === 'open' && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) send.mutate(answer.trim());
          }}
        >
          <label htmlFor={id} className="sr-only">
            Your answer
          </label>
          <Textarea
            id={id}
            value={answer}
            maxLength={ANSWER_MAX_LENGTH}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={isSimpleField(question.path) ? 'Type the value' : 'Your answer'}
            className="min-h-11 text-base"
            aria-invalid={send.error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          <div className="sticky bottom-[env(safe-area-inset-bottom)] flex gap-2 bg-background py-1">
            <Button type="submit" className="h-11 sm:h-9" disabled={busy || !answer.trim()}>
              {send.isPending ? 'Sending…' : 'Submit'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 sm:h-9"
              disabled={busy}
              onClick={() => skip.mutate()}
            >
              Skip
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {errorText(error)}
        </p>
      )}
    </li>
  );
});
