'use client';

import type { CvDetailDto, CvEvent } from '@cv/shared';
import { useEffect, useReducer, useRef } from 'react';
import { applyProgress, isInProgress, progressFromDetail, type ProgressState } from './cv-progress';
import { fetchJob } from './queries/cvs';

/** How often the fallback polls `GET /api/jobs/:id` while the stream is down. */
const FALLBACK_POLL_MS = 3_000;

/**
 * Live progress of a CV's job (AC-5.1, AC-5.4, NFR-M5): an `EventSource` on
 * `/api/cvs/:id/events` (every connect starts with a snapshot), plus `GET /api/jobs/:id`
 * whenever the stream errors and while it stays down. When the tab becomes visible again
 * (iOS drops background connections) the stream is reopened. Stops once the job is finished.
 */
export function useCvProgress(cvId: string, detail: CvDetailDto | undefined): ProgressState {
  const [state, dispatch] = useReducer(applyProgress, detail, (d) =>
    d ? progressFromDetail(d) : { cv: null, job: null },
  );
  // The latest state for the async callbacks below, without restarting the stream.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // The first detail (or a refetch after completion) seeds the state.
  useEffect(() => {
    if (detail) dispatch({ type: 'reset', state: progressFromDetail(detail) });
  }, [detail]);

  const active = detail ? isInProgress(state) : false;

  useEffect(() => {
    if (!active) return;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    const controller = new AbortController();

    const refresh = async () => {
      const jobId = stateRef.current.job?.id;
      if (!jobId) return;
      try {
        dispatch({ type: 'job_status', job: await fetchJob(jobId, controller.signal) });
      } catch {
        // offline or aborted: the next poll or reconnect tries again
      }
    };

    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const connect = () => {
      source?.close();
      source = new EventSource(`/api/cvs/${cvId}/events`);
      source.onopen = stopPolling;
      source.onmessage = (message: MessageEvent<string>) => {
        try {
          dispatch(JSON.parse(message.data) as CvEvent);
        } catch {
          // ignore a malformed message
        }
      };
      source.onerror = () => {
        // EventSource retries by itself (unless the server refused it); meanwhile, poll.
        void refresh();
        pollTimer ??= setInterval(() => void refresh(), FALLBACK_POLL_MS);
      };
    };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (!source || source.readyState === EventSource.CLOSED) connect();
      void refresh();
    };

    connect();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      controller.abort();
      stopPolling();
      source?.close();
    };
  }, [cvId, active]);

  return state;
}
