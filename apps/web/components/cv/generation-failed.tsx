'use client';

import { ErrorCode, isRetryableFailure } from '@cv/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlertIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api-fetch';
import { cvQuery, cvsQuery, retryCv } from '@/lib/queries/cvs';

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
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: cvQuery(cvId).queryKey }),
      queryClient.invalidateQueries({ queryKey: cvsQuery.queryKey, exact: true }),
    ]);
  const retry = useMutation({
    mutationFn: () => retryCv(cvId),
    // The refetched CV is `generating` again, so the progress stream reconnects.
    onSuccess: refresh,
    onError: (error) => {
      // Already restarted (another tab or device) or deleted: show the current state.
      if (
        error instanceof ApiRequestError &&
        (error.code === ErrorCode.ACTIVE_JOB_EXISTS || error.status === 404)
      ) {
        void refresh();
      }
    },
  });
  const retryError =
    retry.error instanceof ApiRequestError && retry.error.code !== ErrorCode.ACTIVE_JOB_EXISTS
      ? retry.error.message
      : retry.error
        ? 'Could not retry. Try again.'
        : null;

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
            disabled={retry.isPending || retry.isSuccess}
            onClick={() => retry.mutate()}
          >
            {retry.isPending || retry.isSuccess ? 'Retrying…' : 'Retry'}
          </Button>
          {retryError && <p className="text-sm text-destructive">{retryError}</p>}
        </div>
      )}
    </div>
  );
}
