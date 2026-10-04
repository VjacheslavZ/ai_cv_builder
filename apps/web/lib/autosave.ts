import { isFieldPathWithin, type CvConflictState, type PatchOp } from '@cv/shared';

// Autosave for the CV editor (AC-10.1, AC-10.4, NFR-M5). Plain TypeScript, no React, so every
// rule is unit-tested: changes are collected per field path (the latest value wins), sent after
// a debounce or on flush, one request at a time, each on top of the last known `version`.
//
// AI updates are not conflicts: when the server reports a newer version that came from an AI
// rewrite of another part (`rebase`), pending changes are re-sent on it automatically. A 409 the
// client cannot explain (another device, or an AI rewrite of the same part) keeps the unsaved
// values and waits for the user to re-apply them.

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

export interface AutosaveState {
  status: AutosaveStatus;
  /** The version the next save is based on. */
  version: number;
  /** Set while `status` is `conflict`: the CV as the server has it now. */
  conflict: CvConflictState | null;
}

/** A failed save. `conflict` is set for `409 VERSION_CONFLICT`. */
export class SaveError extends Error {
  constructor(readonly conflict: CvConflictState | null = null) {
    super(conflict ? 'Version conflict' : 'Save failed');
  }
}

export interface AutosaveOptions {
  version: number;
  save(baseVersion: number, ops: PatchOp[]): Promise<{ version: number }>;
  /** Debounce after the last change; default 1 s. */
  debounceMs?: number;
  /** How long a 409 waits for the SSE event that explains it; default 2 s. */
  explainMs?: number;
}

export class Autosave {
  private state: AutosaveState;
  private readonly pending = new Map<string, unknown>();
  private inFlight: PatchOp[] | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private explainTimer: ReturnType<typeof setTimeout> | undefined;
  /** A 409 waiting for the SSE event that would explain it. */
  private waitingFor: CvConflictState | null = null;
  /** AI rewrites we were told about: version → rewritten path. */
  private readonly aiUpdates = new Map<number, string>();
  private readonly listeners = new Set<() => void>();
  private readonly debounceMs: number;
  private readonly explainMs: number;

  constructor(private readonly options: AutosaveOptions) {
    this.state = { status: 'idle', version: options.version, conflict: null };
    this.debounceMs = options.debounceMs ?? 1_000;
    this.explainMs = options.explainMs ?? 2_000;
  }

  getState = (): AutosaveState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** True while some change is not confirmed by the server yet. */
  get dirty(): boolean {
    return this.pending.size > 0 || this.inFlight !== null;
  }

  /** Paths with unsaved changes (pending or in flight). */
  unsavedPaths(): string[] {
    return [...new Set([...this.pending.keys(), ...(this.inFlight ?? []).map((op) => op.path)])];
  }

  /** A field changed. Saved after the debounce, or on `flush`. */
  set(path: string, value: unknown): void {
    this.pending.set(path, value);
    if (this.state.status === 'conflict') return;
    this.update({ status: this.inFlight ? 'saving' : 'pending' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  /** Save now (on blur, and when the tab is hidden). */
  flush(): void {
    clearTimeout(this.timer);
    if (this.inFlight || this.pending.size === 0 || this.state.status === 'conflict') return;
    const ops: PatchOp[] = [...this.pending].map(([path, value]) => ({ op: 'set', path, value }));
    this.pending.clear();
    this.send(ops);
  }

  /**
   * The AI rewrote `path` and the CV is now `current` (SSE `section_updated`, then a refetch).
   * Unsaved changes inside that part are a real conflict; anything else is re-sent on the new
   * version.
   */
  rebase(current: CvConflictState, path: string): void {
    const { version } = current;
    this.aiUpdates.set(version, path);
    if (version <= this.state.version) return;
    if (this.overlaps(path)) {
      this.enterConflict(current);
      return;
    }
    // An in-flight save based on the old version gets a 409; `onConflict` re-sends it.
    if (!this.inFlight) this.update({ version });
    if (this.explainTimer) this.retryExplained(version);
  }

  /** "Re-apply my changes": send the kept values on top of the version the server has now. */
  reapply(): void {
    const conflict = this.state.conflict;
    if (!conflict) return;
    this.update({ status: 'pending', version: conflict.version, conflict: null });
    this.flush();
  }

  /** Drop the unsaved values and continue from the server's version. */
  discard(): void {
    const conflict = this.state.conflict;
    this.pending.clear();
    this.update({
      status: 'idle',
      version: conflict?.version ?? this.state.version,
      conflict: null,
    });
  }

  /** Stops the timers; pending changes stay (call `flush` first to send them). */
  dispose(): void {
    clearTimeout(this.timer);
    clearTimeout(this.explainTimer);
  }

  private send(ops: PatchOp[]): void {
    this.inFlight = ops;
    this.update({ status: 'saving' });
    this.options.save(this.state.version, ops).then(
      ({ version }) => {
        this.inFlight = null;
        this.update({ version, status: this.pending.size > 0 ? 'pending' : 'saved' });
        if (this.pending.size > 0) this.flush();
      },
      (error: unknown) => {
        const failed = this.inFlight ?? [];
        this.inFlight = null;
        // Keep the failed values unless a newer value for the same field is already pending.
        for (const op of failed)
          if (!this.pending.has(op.path)) this.pending.set(op.path, op.value);
        if (error instanceof SaveError && error.conflict) this.onConflict(error.conflict, failed);
        else this.update({ status: 'error' });
      },
    );
  }

  private onConflict(current: CvConflictState, failed: PatchOp[]): void {
    const aiPath = this.aiUpdates.get(current.version);
    if (aiPath !== undefined) {
      if (failed.some((op) => touches(op.path, aiPath)) || this.overlaps(aiPath)) {
        this.enterConflict(current);
      } else {
        this.update({ version: current.version, status: 'pending' });
        this.flush();
      }
      return;
    }
    // Maybe the SSE event for this version is on its way: wait for it a little.
    this.update({ status: 'saving' });
    this.waitingFor = current;
    this.explainTimer = setTimeout(() => {
      this.explainTimer = undefined;
      this.waitingFor = null;
      this.enterConflict(current);
    }, this.explainMs);
  }

  private retryExplained(version: number): void {
    const current = this.waitingFor;
    if (!current || current.version !== version) return;
    clearTimeout(this.explainTimer);
    this.explainTimer = undefined;
    this.waitingFor = null;
    this.onConflict(current, []);
  }

  private enterConflict(current: CvConflictState): void {
    clearTimeout(this.timer);
    this.update({ status: 'conflict', conflict: current });
  }

  private overlaps(path: string): boolean {
    return this.unsavedPaths().some((p) => touches(p, path));
  }

  private update(patch: Partial<AutosaveState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** Two paths touch when one contains the other. */
function touches(a: string, b: string): boolean {
  return isFieldPathWithin(a, b) || isFieldPathWithin(b, a);
}
