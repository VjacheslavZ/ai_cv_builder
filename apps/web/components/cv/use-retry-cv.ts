'use client';

import { ErrorCode } from '@cv/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '@/lib/api-fetch';
import { cvQuery, cvsQuery, retryCv } from '@/lib/queries/cvs';

/** Already restarted (another tab or device) or deleted: just show the current state. */
function isStale(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.code === ErrorCode.ACTIVE_JOB_EXISTS || error.status === 404)
  );
}

/** What to tell the user about a failed retry; `null` when there is nothing to say. */
export function retryErrorText(error: unknown): string | null {
  if (!error || isStale(error)) return null;
  return error instanceof ApiRequestError ? error.message : 'Could not retry. Try again.';
}

/**
 * "Retry" on a failed generation (AC-5.6), shared by the progress screen and the dashboard.
 * Afterwards the CV and the list are refetched: the CV is `generating` again.
 */
export function useRetryCv(cvId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: cvQuery(cvId).queryKey }),
      queryClient.invalidateQueries({ queryKey: cvsQuery.queryKey, exact: true }),
    ]);
  const retry = useMutation({
    mutationFn: () => retryCv(cvId),
    onSuccess: refresh,
    onError: (error) => {
      if (isStale(error)) void refresh();
    },
  });
  return {
    retry,
    errorText: retryErrorText(retry.error),
    busy: retry.isPending || retry.isSuccess,
  };
}
