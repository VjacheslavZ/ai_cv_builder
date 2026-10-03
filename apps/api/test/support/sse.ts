import type { CvEvent } from '@cv/shared';

export interface SseStream {
  status: number;
  contentType: string | null;
  /** The next event, waiting up to `timeoutMs`. */
  next(timeoutMs?: number): Promise<CvEvent>;
  /** Events until (and including) the first that matches. */
  until(match: (event: CvEvent) => boolean, timeoutMs?: number): Promise<CvEvent[]>;
  close(): void;
}

/** Opens `GET url` as an SSE stream and parses `data:` messages (as EventSource would). */
export async function openSse(url: string, cookie: string): Promise<SseStream> {
  const controller = new AbortController();
  const res = await fetch(url, {
    headers: { Cookie: cookie, Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  const queue: CvEvent[] = [];
  const waiters: (() => void)[] = [];
  let buffer = '';

  if (res.ok && res.body) {
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const message = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = message
              .split('\n')
              .filter((line) => line.startsWith('data: '))
              .map((line) => line.slice(6))
              .join('\n');
            if (data) {
              queue.push(JSON.parse(data) as CvEvent);
              waiters.splice(0).forEach((wake) => wake());
            }
          }
        }
      } catch {
        // aborted
      }
    })();
  }

  const next = async (timeoutMs = 10_000): Promise<CvEvent> => {
    const deadline = Date.now() + timeoutMs;
    while (queue.length === 0) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('Timed out waiting for an SSE event');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return queue.shift()!;
  };

  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    next,
    async until(match, timeoutMs = 10_000) {
      const events: CvEvent[] = [];
      for (;;) {
        const event = await next(timeoutMs);
        events.push(event);
        if (match(event)) return events;
      }
    },
    close: () => controller.abort(),
  };
}
