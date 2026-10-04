'use client';

import type { CvEvent } from '@cv/shared';
import { useEffect, useRef } from 'react';

const FALLBACK_POLL_MS = 3_000;

export interface CvEventHandlers {
  onEvent(event: CvEvent): void;
  /** Called while the stream is down (and once on every error): read the state over HTTP. */
  onPoll(): void;
}

/**
 * The CV's event stream while `enabled` (an answer is being applied, AC-9.4): every connect
 * starts with a snapshot; while the stream is down, `onPoll` runs every few seconds, and when the
 * tab becomes visible again (iOS drops background connections) (NFR-M5).
 */
export function useCvEvents(cvId: string, enabled: boolean, handlers: CvEventHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    let poll: ReturnType<typeof setInterval> | undefined;
    const source = new EventSource(`/api/cvs/${cvId}/events`);
    source.onopen = () => {
      clearInterval(poll);
      poll = undefined;
    };
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        ref.current.onEvent(JSON.parse(message.data) as CvEvent);
      } catch {
        // ignore a malformed message
      }
    };
    source.onerror = () => {
      ref.current.onPoll();
      poll ??= setInterval(() => ref.current.onPoll(), FALLBACK_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') ref.current.onPoll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(poll);
      source.close();
    };
  }, [cvId, enabled]);
}
