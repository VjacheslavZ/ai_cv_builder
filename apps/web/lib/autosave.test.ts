import { emptyCvDocument, type CvConflictState, type PatchOp } from '@cv/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosave, SaveError } from './autosave';

const E = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';
const BULLET = `experience.${E}.bullets.7d9e8f00-1a2b-4c3d-8e4f-5a6b7c8d9e0f`;

interface Call {
  baseVersion: number;
  ops: PatchOp[];
  resolve(version: number): void;
  reject(error: unknown): void;
}

function setup(version = 1) {
  const calls: Call[] = [];
  const save = (baseVersion: number, ops: PatchOp[]) =>
    new Promise<{ version: number }>((resolve, reject) => {
      calls.push({ baseVersion, ops, resolve: (v) => resolve({ version: v }), reject });
    });
  const autosave = new Autosave({ version, save, debounceMs: 1_000, explainMs: 2_000 });
  return { autosave, calls };
}

const state = (version: number): CvConflictState => ({ version, document: emptyCvDocument() });
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('Autosave (AC-10.1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces changes into one save with the latest value per field', async () => {
    const { autosave, calls } = setup();
    autosave.set('summary', 'H');
    autosave.set('summary', 'Hello');
    autosave.set('contact.city', 'London');
    expect(autosave.getState().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      baseVersion: 1,
      ops: [
        { op: 'set', path: 'summary', value: 'Hello' },
        { op: 'set', path: 'contact.city', value: 'London' },
      ],
    });
    expect(autosave.getState().status).toBe('saving');
    calls[0]!.resolve(2);
    await settle();
    expect(autosave.getState()).toMatchObject({ status: 'saved', version: 2 });
  });

  it('flush sends at once (blur, tab hidden)', async () => {
    const { autosave, calls } = setup();
    autosave.set('summary', 'Hi');
    autosave.flush();
    expect(calls).toHaveLength(1);
  });

  it('keeps one request in flight and sends the next on the new version', async () => {
    const { autosave, calls } = setup();
    autosave.set('summary', 'One');
    autosave.flush();
    autosave.set('summary', 'Two');
    autosave.flush();
    expect(calls).toHaveLength(1);
    calls[0]!.resolve(2);
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ baseVersion: 2, ops: [{ path: 'summary', value: 'Two' }] });
  });

  it('keeps unsaved values after a network error and retries on the next flush', async () => {
    const { autosave, calls } = setup();
    autosave.set('summary', 'Hi');
    autosave.flush();
    calls[0]!.reject(new SaveError());
    await settle();
    expect(autosave.getState().status).toBe('error');
    expect(autosave.dirty).toBe(true);
    autosave.flush();
    expect(calls[1]).toMatchObject({ baseVersion: 1, ops: [{ path: 'summary', value: 'Hi' }] });
  });
});

describe('Autosave and AI updates (AC-10.4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes the new version after an AI update of another part, without a conflict', async () => {
    const { autosave, calls } = setup();
    autosave.rebase(state(2), `experience.${E}`);
    autosave.set('summary', 'Typed meanwhile');
    autosave.flush();
    expect(calls[0]!.baseVersion).toBe(2);
    expect(autosave.getState().status).toBe('saving');
  });

  it('re-sends an in-flight save that lost the race to an AI update elsewhere', async () => {
    const { autosave, calls } = setup();
    autosave.set('summary', 'Typed meanwhile');
    autosave.flush();
    autosave.rebase(state(2), `experience.${E}`);
    calls[0]!.reject(new SaveError(state(2)));
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ baseVersion: 2, ops: [{ path: 'summary' }] });
    calls[1]!.resolve(3);
    await settle();
    expect(autosave.getState()).toMatchObject({ status: 'saved', version: 3, conflict: null });
  });

  it('waits for the SSE event when the 409 arrives first', async () => {
    const { autosave, calls } = setup();
    autosave.set('summary', 'Typed meanwhile');
    autosave.flush();
    calls[0]!.reject(new SaveError(state(2)));
    await settle();
    expect(autosave.getState().status).toBe('saving');
    autosave.rebase(state(2), `experience.${E}`);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.baseVersion).toBe(2);
  });

  it('is a real conflict when unsaved changes touch the part the AI rewrote', async () => {
    const { autosave, calls } = setup();
    autosave.set(BULLET, 'My edit');
    autosave.rebase(state(2), `experience.${E}`);
    expect(autosave.getState()).toMatchObject({ status: 'conflict', conflict: { version: 2 } });
    autosave.flush();
    expect(calls).toHaveLength(0);
  });

  it('is a real conflict when no AI update explains the 409 (another device)', async () => {
    const { autosave, calls } = setup();
    autosave.set('summary', 'Mine');
    autosave.flush();
    calls[0]!.reject(new SaveError(state(5)));
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(autosave.getState()).toMatchObject({ status: 'conflict', conflict: { version: 5 } });
    expect(autosave.unsavedPaths()).toEqual(['summary']);
  });

  it('re-applies the kept changes on the current version, or discards them', async () => {
    const { autosave, calls } = setup();
    autosave.set('summary', 'Mine');
    autosave.flush();
    calls[0]!.reject(new SaveError(state(5)));
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    autosave.set('contact.city', 'Typed during the conflict');
    autosave.reapply();
    expect(calls[1]).toMatchObject({
      baseVersion: 5,
      ops: [{ path: 'summary', value: 'Mine' }, { path: 'contact.city' }],
    });

    const other = setup();
    other.autosave.set('summary', 'Mine');
    other.autosave.flush();
    other.calls[0]!.reject(new SaveError(state(7)));
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    other.autosave.discard();
    expect(other.autosave.getState()).toMatchObject({ status: 'idle', version: 7 });
    expect(other.autosave.dirty).toBe(false);
  });
});

describe('Autosave list ops (AC-10.2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const NEW = 'a02b1c33-4d5e-4f6a-9b7c-8d9e0f1a2b3c';
  const LIST = `experience.${E}.bullets`;
  const ITEM = `${LIST}.${NEW}`;

  it('keeps ops in order and sends list ops at once', async () => {
    const { autosave, calls } = setup();
    autosave.set('summary', 'Hi');
    autosave.insert(LIST, 0, { id: NEW, text: '' });
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ops).toEqual([
      { op: 'set', path: 'summary', value: 'Hi' },
      { op: 'insert', path: LIST, index: 0, value: { id: NEW, text: '' } },
    ]);
    // Typed into the new item while it was saving: sent after it, in the next save.
    autosave.set(ITEM, 'Shipped');
    autosave.move(ITEM, 1);
    expect(autosave.unsavedPaths()).toEqual(['summary', ITEM]);
    calls[0]!.resolve(2);
    await settle();
    expect(calls[1]).toMatchObject({
      baseVersion: 2,
      ops: [
        { op: 'set', path: ITEM, value: 'Shipped' },
        { op: 'move', path: ITEM, index: 1 },
      ],
    });
  });

  it('a later value of a field replaces its queued one in place', async () => {
    const { autosave, calls } = setup();
    autosave.insert(LIST, 0, { id: NEW, text: '' });
    autosave.set(ITEM, 'S');
    autosave.set('summary', 'Hi');
    autosave.set(ITEM, 'Shipped');
    await settle();
    expect(calls[0]!.ops.map((op) => op.op === 'set' && op.value)).toEqual([
      false,
      'Shipped',
      'Hi',
    ]);
  });

  it('removing an item drops its unsaved changes; an unsaved new item is never sent', async () => {
    const { autosave, calls } = setup();
    autosave.set(BULLET, 'typed');
    autosave.remove(BULLET);
    autosave.insert(LIST, 0, { id: NEW, text: '' });
    autosave.set(ITEM, 'typed too');
    autosave.remove(ITEM);
    await settle();
    expect(calls[0]!.ops).toEqual([{ op: 'remove', path: BULLET }]);
  });

  it('nothing left to send after removing an unsaved item: saved', async () => {
    const { autosave, calls } = setup();
    autosave.insert(LIST, 0, { id: NEW, text: '' });
    autosave.remove(ITEM);
    await settle();
    expect(calls).toHaveLength(0);
    expect(autosave.getState().status).toBe('saved');
    expect(autosave.dirty).toBe(false);
  });

  it('a failed save puts its ops back in front of the newer ones', async () => {
    const { autosave, calls } = setup();
    autosave.insert(LIST, 0, { id: NEW, text: '' });
    await settle();
    autosave.set(ITEM, 'Shipped');
    calls[0]!.reject(new SaveError());
    await settle();
    expect(autosave.getState().status).toBe('error');
    expect(autosave.unsavedOps().map((op) => op.op)).toEqual(['insert', 'set']);
  });
});
