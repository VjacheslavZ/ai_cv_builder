import { emptyCvDocument, type PatchOp } from '@cv/shared';
import { describe, expect, it, vi } from 'vitest';
import { Autosave, SaveError } from './autosave';
import { downloadPdf } from './download-pdf';

const CV_ID = '5f0c3a52-8f4b-4d5e-9c1a-2b3c4d5e6f70';

function setup() {
  const calls: { ops: PatchOp[]; resolve(v: number): void; reject(e: unknown): void }[] = [];
  const autosave = new Autosave({
    version: 1,
    save: (_, ops) =>
      new Promise((resolve, reject) => {
        calls.push({ ops, resolve: (v) => resolve({ version: v }), reject });
      }),
  });
  return { autosave, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('downloadPdf (AC-11.3)', () => {
  it('navigates at once when everything is saved', async () => {
    const { autosave } = setup();
    const navigate = vi.fn();
    await expect(downloadPdf(autosave, CV_ID, navigate)).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledWith(`/api/cvs/${CV_ID}/pdf`);
  });

  it('flushes the pending change and waits for it before navigating', async () => {
    const { autosave, calls } = setup();
    const navigate = vi.fn();
    autosave.set('summary', 'Just typed');

    const done = downloadPdf(autosave, CV_ID, navigate);
    // Sent without waiting for the debounce.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ops).toEqual([{ op: 'set', path: 'summary', value: 'Just typed' }]);
    await tick();
    expect(navigate).not.toHaveBeenCalled();

    calls[0]!.resolve(2);
    await expect(done).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('waits for a change typed while a save is in flight', async () => {
    const { autosave, calls } = setup();
    const navigate = vi.fn();
    autosave.set('summary', 'One');
    autosave.flush();
    autosave.set('summary', 'Two');

    const done = downloadPdf(autosave, CV_ID, navigate);
    calls[0]!.resolve(2);
    await tick();
    expect(calls).toHaveLength(2);
    expect(navigate).not.toHaveBeenCalled();
    calls[1]!.resolve(3);
    await expect(done).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('does not download when the save fails or conflicts', async () => {
    const failing = setup();
    const navigate = vi.fn();
    failing.autosave.set('summary', 'x');
    const failed = downloadPdf(failing.autosave, CV_ID, navigate);
    failing.calls[0]!.reject(new SaveError());
    await expect(failed).resolves.toBe(false);

    // An unexplained 409 becomes a conflict after the explain window.
    vi.useFakeTimers();
    const conflicting = setup();
    conflicting.autosave.set('summary', 'y');
    conflicting.autosave.flush();
    conflicting.calls[0]!.reject(new SaveError({ version: 5, document: emptyCvDocument() }));
    const conflicted = downloadPdf(conflicting.autosave, CV_ID, navigate);
    await vi.advanceTimersByTimeAsync(2_000);
    vi.useRealTimers();
    await expect(conflicted).resolves.toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
