import type { QuestionDto } from '@cv/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  editorStatus,
  EditorStatusStore,
  isFlashed,
  isLocked,
  isLockedIn,
  isMarked,
  locksAround,
} from './editor-status';

const E = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';
const F = '1c7d2a6f-5d2b-4e3c-8b88-2a3f4e5d6c7b';

const q = (path: string, status: QuestionDto['status'] = 'open'): QuestionDto => ({
  id: path,
  path,
  type: 'missing',
  priority: 0,
  text: 'x',
  status,
  answer: null,
});

describe('editorStatus', () => {
  const status = editorStatus(
    [
      q(`experience.${E}.dates`),
      q('education'),
      q('contact.phone', 'dismissed'),
      q(`experience.${F}.bullets`, 'applying'),
      q('skills', 'applying'),
    ],
    ['summary'],
  );

  it('marks exact places of open questions only', () => {
    expect(isMarked(status, `experience.${E}.dates`)).toBe(true);
    expect(isMarked(status, `experience.${E}`)).toBe(false);
    expect(isMarked(status, 'education')).toBe(true);
    expect(isMarked(status, 'contact.phone')).toBe(false);
  });

  it('locks the part an answer rewrites, and everything inside it (AC-9.4)', () => {
    expect(status.lockedScopes).toEqual([`experience.${F}`, 'skills']);
    expect(isLocked(status, `experience.${F}.company`)).toBe(true);
    expect(isLocked(status, `experience.${E}.company`)).toBe(false);
    expect(isLocked(status, 'experience')).toBe(false);
    expect(isLocked(status, `skills.${E}`)).toBe(true);
  });

  it('flashes a rewritten part and everything inside it', () => {
    expect(isFlashed(status, 'summary')).toBe(true);
    expect(isFlashed(status, 'skills')).toBe(false);
  });

  it('gives a list the locks around and inside it only', () => {
    const locks = locksAround(status, 'experience');
    expect(locks).toBe(`experience.${F}`);
    expect(isLockedIn(locks, `experience.${F}`)).toBe(true);
    expect(isLockedIn(locks, `experience.${E}`)).toBe(false);
    expect(isLockedIn(locks, 'experience')).toBe(false);
    expect(locksAround(status, `experience.${E}.bullets`)).toBe('');
    expect(isLockedIn('', 'experience')).toBe(false);
    expect(isLockedIn(locksAround(status, `skills`), `skills.${E}`)).toBe(true);
  });
});

describe('EditorStatusStore', () => {
  const empty = { openPaths: [], lockedScopes: [], flashed: [] };

  it('notifies on a change, not on an equal status', () => {
    const store = new EditorStatusStore(empty);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ openPaths: [], lockedScopes: [], flashed: [] });
    expect(listener).not.toHaveBeenCalled();

    const next = { ...empty, openPaths: ['summary'] };
    store.set(next);
    expect(listener).toHaveBeenCalledOnce();
    expect(store.get()).toBe(next);
  });

  it('stops notifying after unsubscribe', () => {
    const store = new EditorStatusStore(empty);
    const listener = vi.fn();
    store.subscribe(listener)();
    store.set({ ...empty, flashed: ['skills'] });
    expect(listener).not.toHaveBeenCalled();
  });
});
