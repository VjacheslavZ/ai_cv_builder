import { applyScopeFor, isFieldPathWithin, type QuestionDto } from '@cv/shared';

/** What the editor shows around its fields, by field path. */
export interface EditorStatus {
  /** Where open questions point (AC-8.1). */
  openPaths: readonly string[];
  /** Entries or sections an `apply_answer` job is rewriting: read-only until it ends (AC-9.4). */
  lockedScopes: readonly string[];
  /** Parts the AI just rewrote, highlighted for a moment (AC-9.1). */
  flashed: readonly string[];
}

export function editorStatus(questions: QuestionDto[], flashed: readonly string[]): EditorStatus {
  return {
    openPaths: questions.filter((q) => q.status === 'open').map((q) => q.path),
    lockedScopes: questions
      .filter((q) => q.status === 'applying')
      .flatMap((q) => applyScopeFor(q.path) ?? []),
    flashed,
  };
}

/**
 * The editor's status as a store, so each field subscribes to its own slice ("is this path
 * locked?") with `useSyncExternalStore`: answering a question re-renders the fields it touches,
 * not the whole form. Setting an equal status notifies nobody.
 */
export class EditorStatusStore {
  private readonly listeners = new Set<() => void>();

  constructor(private status: EditorStatus) {}

  get = (): EditorStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(next: EditorStatus): void {
    if (sameStatus(this.status, next)) return;
    this.status = next;
    for (const listener of this.listeners) listener();
  }
}

function sameStatus(a: EditorStatus, b: EditorStatus): boolean {
  return (
    sameList(a.openPaths, b.openPaths) &&
    sameList(a.lockedScopes, b.lockedScopes) &&
    sameList(a.flashed, b.flashed)
  );
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** An open question points exactly here (`experience.<id>.dates`, `education`). */
export const isMarked = (status: EditorStatus, path: string) => status.openPaths.includes(path);

/** The AI is rewriting `path` or a part that contains it. */
export const isLocked = (status: EditorStatus, path: string) =>
  status.lockedScopes.some((scope) => isFieldPathWithin(path, scope));

/** The AI just rewrote `path` or a part that contains it. */
export const isFlashed = (status: EditorStatus, path: string) =>
  status.flashed.some((scope) => isFieldPathWithin(path, scope));

/**
 * The locks on a list at `path`: the locked scopes around it or inside it, joined into one
 * string, a snapshot that changes only when this list's locks change.
 */
export const locksAround = (status: EditorStatus, path: string): string =>
  status.lockedScopes
    .filter((scope) => isFieldPathWithin(path, scope) || isFieldPathWithin(scope, path))
    .join('\n');

/** `isLocked` for a snapshot from `locksAround`. */
export const isLockedIn = (locks: string, path: string) =>
  locks !== '' && locks.split('\n').some((scope) => isFieldPathWithin(path, scope));
