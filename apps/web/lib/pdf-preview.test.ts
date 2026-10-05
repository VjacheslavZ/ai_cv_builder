import { ErrorCode } from '@cv/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api-fetch';
import { PdfPreview } from './pdf-preview';

interface Call {
  signal: AbortSignal;
  resolve(): void;
  reject(error: unknown): void;
}

function setup() {
  const calls: Call[] = [];
  const revoked: string[] = [];
  let urls = 0;
  const preview = new PdfPreview({
    fetchPdf: (signal) =>
      new Promise<Blob>((resolve, reject) => {
        calls.push({ signal, resolve: () => resolve(new Blob(['%PDF'])), reject });
      }),
    toUrl: () => `blob:${++urls}`,
    revoke: (url) => revoked.push(url),
    settleMs: 1_500,
  });
  return { preview, calls, revoked };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const limited = () => new ApiRequestError(429, { code: ErrorCode.RATE_LIMITED, message: 'Paused' });

describe('PdfPreview (AC-11.7)', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-05T12:00:10Z') }));
  afterEach(() => vi.useRealTimers());

  it('loads the saved version at once, then shows it when its frame has loaded', async () => {
    const { preview, calls } = setup();
    preview.update(3, true);
    await settle();
    expect(calls).toHaveLength(1);
    expect(preview.getState().status).toBe('loading');

    calls[0]!.resolve();
    await settle();
    expect(preview.getState()).toMatchObject({ incoming: { version: 3, url: 'blob:1' } });
    preview.displayed('blob:1');
    expect(preview.getState()).toEqual({
      shown: { version: 3, url: 'blob:1' },
      incoming: null,
      status: 'idle',
    });
  });

  it('waits until autosave settles, and for a quiet moment after the save', async () => {
    const { preview, calls } = setup();
    preview.update(3, true);
    await settle();
    calls[0]!.resolve();
    await settle();
    preview.displayed('blob:1');

    preview.update(3, false); // typing
    preview.update(4, true); // saved
    await vi.advanceTimersByTimeAsync(1_000);
    preview.update(4, false); // typing again: the reload waits
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1);
    preview.update(5, true);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
  });

  it('keeps one load in flight and catches up with the newest version afterwards', async () => {
    const { preview, calls, revoked } = setup();
    preview.update(3, true);
    await settle();
    preview.update(4, true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1);

    calls[0]!.resolve();
    await settle();
    preview.displayed('blob:1');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(calls).toHaveLength(2);
    calls[1]!.resolve();
    await settle();
    preview.displayed('blob:2');
    expect(preview.getState().shown).toEqual({ version: 4, url: 'blob:2' });
    expect(revoked).toEqual(['blob:1']);
  });

  it('never reloads the version already on screen', async () => {
    const { preview, calls } = setup();
    preview.update(3, true);
    await settle();
    calls[0]!.resolve();
    await settle();
    preview.displayed('blob:1');
    preview.update(3, true);
    preview.update(2, true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
  });

  it('ignores a frame that is no longer the incoming one', async () => {
    const { preview, calls } = setup();
    preview.update(3, true);
    await settle();
    calls[0]!.resolve();
    await settle();
    preview.displayed('blob:old');
    expect(preview.getState()).toMatchObject({ shown: null, incoming: { url: 'blob:1' } });
  });

  it('pauses on the per-minute limit, keeps the page on screen, and retries next minute', async () => {
    const { preview, calls } = setup();
    preview.update(3, true);
    await settle();
    calls[0]!.resolve();
    await settle();
    preview.displayed('blob:1');

    preview.update(4, true);
    await vi.advanceTimersByTimeAsync(1_500);
    calls[1]!.reject(limited());
    await settle();
    expect(preview.getState()).toMatchObject({ status: 'paused', shown: { version: 3 } });
    // 12:00:11.5 now: the next window starts at 12:01:00.
    await vi.advanceTimersByTimeAsync(48_000);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(3);
  });

  it('after a failed render, waits for the next version instead of retrying', async () => {
    const { preview, calls } = setup();
    preview.update(3, true);
    await settle();
    calls[0]!.reject(new ApiRequestError(500, { code: ErrorCode.INTERNAL, message: 'x' }));
    await settle();
    expect(preview.getState().status).toBe('error');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);

    preview.update(4, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
  });

  it('dispose aborts the load and frees every URL', async () => {
    const { preview, calls, revoked } = setup();
    preview.update(3, true);
    await settle();
    calls[0]!.resolve();
    await settle();
    preview.displayed('blob:1');
    preview.update(4, true);
    await vi.advanceTimersByTimeAsync(1_500);
    preview.dispose();
    expect(calls[1]!.signal.aborted).toBe(true);
    expect(revoked).toEqual(['blob:1']);
  });
});
