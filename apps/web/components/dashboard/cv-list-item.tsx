'use client';

import { isRetryableFailure, type CvSummaryDto } from '@cv/shared';
import { RotateCcwIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';

import { CvStatusBadge } from '@/components/cv/cv-status-badge';
import { retryErrorText, useRetryCv } from '@/components/cv/use-retry-cv';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function questionsLabel(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? '1 open question' : `${count} open questions`;
}

/** One dashboard row: open, retry a failed generation (AC-5.6), delete. */
export function CvListItem({ cv, onDelete }: { cv: CvSummaryDto; onDelete(): void }) {
  const questions = questionsLabel(cv.openQuestions);
  const canRetry = cv.status === 'failed' && isRetryableFailure(cv.failureCode);
  return (
    <li className="flex items-center gap-2 p-2 pl-4">
      <Link
        href={`/cvs/${cv.id}`}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-1 rounded-md py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="truncate font-medium">{cv.title}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <CvStatusBadge status={cv.status} />
          {questions && <span>{questions}</span>}
          <time dateTime={cv.updatedAt}>{dateFormat.format(new Date(cv.updatedAt))}</time>
        </span>
      </Link>
      {canRetry && <RetryButton cv={cv} />}
      <Button
        variant="ghost"
        size="icon-lg"
        className="size-11"
        aria-label={`Delete ${cv.title}`}
        onClick={onDelete}
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}

function RetryButton({ cv }: { cv: CvSummaryDto }) {
  const { retry, busy } = useRetryCv(cv.id);
  return (
    <Button
      variant="outline"
      className="h-11"
      aria-label={`Retry ${cv.title}`}
      disabled={busy}
      onClick={() =>
        retry.mutate(undefined, {
          onError: (error) => {
            const title = retryErrorText(error);
            if (title) toast.add({ title, type: 'error' });
          },
        })
      }
    >
      <RotateCcwIcon aria-hidden />
      {busy ? 'Retrying…' : 'Retry'}
    </Button>
  );
}
