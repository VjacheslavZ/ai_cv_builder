'use client';

import { isRetryableFailure, type ErrorCode } from '@cv/shared';
import { CircleAlertIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useRetryCv } from './use-retry-cv';

interface GenerationFailedProps {
  cvId: string;
  failureCode: ErrorCode | null;
  message: string | null;
  /** When the last attempt failed: after a Retry that fails again, this is what changes. */
  failedAt: string | null;
}

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * The reason in plain language and "Retry" on the saved source (AC-5.6). A PDF problem has no
 * Retry: the message tells the user to upload another file or paste text.
 */
export function GenerationFailed({ cvId, failureCode, message, failedAt }: GenerationFailedProps) {
  const { retry, errorText: retryError, busy } = useRetryCv(cvId);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4" role="alert">
      <p className="flex gap-2 font-medium text-destructive">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Generation failed
        {failedAt && (
          <time dateTime={failedAt} className="font-normal text-muted-foreground">
            at {timeFormat.format(new Date(failedAt))}
          </time>
        )}
      </p>
      <p className="text-sm">{message ?? 'Something went wrong while generating your CV.'}</p>
      {isRetryableFailure(failureCode) && (
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="h-11 self-start"
            disabled={busy}
            onClick={() => retry.mutate()}
          >
            {busy ? 'Retrying…' : 'Retry'}
          </Button>
          {retryError && <p className="text-sm text-destructive">{retryError}</p>}
        </div>
      )}
    </div>
  );
}
