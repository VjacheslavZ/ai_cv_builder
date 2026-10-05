import { isFieldPathWithin, type CvConflictState, type PatchOp } from '@cv/shared';

// Autosave for the CV editor (AC-10.1, AC-10.4, NFR-M5). Plain TypeScript, no React, so every
// rule is unit-tested: changes are queued as ops in the order they happened (a field's latest
// value replaces its earlier `set`; list ops, AC-10.2, keep their place), sent after a debounce
// or on flush, one request at a time, each on top of the last known `version`.
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
  private pending: PatchOp[] = [];
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
    return this.pending.length > 0 || this.inFlight !== null;
  }

  /** The places with unsaved changes (pending or in flight); an added item by its own path. */
  unsavedPaths(): string[] {
    return [...new Set(this.unsavedOps().map(targetOf))];
  }

  /** Every unsaved op, in order: what a conflict replays on top of the server's state. */
  unsavedOps(): PatchOp[] {
    return [...(this.inFlight ?? []), ...this.pending];
  }

  /** A field changed. Saved after the debounce, or on `flush`. */
  set(path: string, value: unknown): void {
    const queued = this.pending.find((op) => op.op === 'set' && op.path === path);
    if (queued) (queued as { value: unknown }).value = value;
    else this.pending.push({ op: 'set', path, value });
    this.schedule(this.debounceMs);
  }

  /** A new item at `index` of the list at `path` (AC-10.2). Saved at once. */
  insert<T extends { id: string }>(path: string, index: number, value: T): void {
    this.pending.push({ op: 'insert', path, index, value });
    this.schedule(0);
  }

  /** The item at `path` moved to `index` of its list. Saved at once. */
  move(path: string, index: number): void {
    this.pending.push({ op: 'move', path, index });
    this.schedule(0);
  }

  /**
   * The item at `path` was removed. Unsaved changes inside it are dropped (the server would
   * reject them); if the item itself was never saved, nothing is sent at all.
   */
  remove(path: string): void {
    const unsavedInsert = this.pending.some((op) => op.op === 'insert' && targetOf(op) === path);
    this.pending = this.pending.filter((op) => !isFieldPathWithin(targetOf(op), path));
    if (!unsavedInsert) this.pending.push({ op: 'remove', path });
    this.schedule(0);
  }

  /** Save now (on blur, and when the tab is hidden). */
  flush(): void {
    clearTimeout(this.timer);
    if (this.inFlight || this.pending.length === 0 || this.state.status === 'conflict') return;
    const ops = this.pending;
    this.pending = [];
    this.send(ops);
  }

  /**
   * Saves now and resolves once nothing is unsaved (`true`), or with `false` as soon as a save
   * fails or conflicts. "Download PDF" waits on it: the server renders the saved version
   * (AC-11.3).
   */
  whenSaved(): Promise<boolean> {
    this.flush();
    return new Promise((resolve) => {
      const check = () => {
        const { status } = this.state;
        const failed = status === 'error' || status === 'conflict';
        if (!failed && this.dirty) return;
        unsubscribe();
        resolve(!failed);
      };
      const unsubscribe = this.subscribe(check);
      check();
    });
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
    this.pending = [];
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

  private schedule(delayMs: number): void {
    if (this.state.status === 'conflict') return;
    if (this.pending.length === 0 && !this.inFlight) {
      clearTimeout(this.timer);
      this.update({ status: 'saved' });
      return;
    }
    this.update({ status: this.inFlight ? 'saving' : 'pending' });
    clearTimeout(this.timer);
    // A queued list op goes out at once: typing after it must not hold it back.
    const listOpQueued = this.pending.some((op) => op.op !== 'set');
    this.timer = setTimeout(() => this.flush(), listOpQueued ? 0 : delayMs);
  }

  private send(ops: PatchOp[]): void {
    this.inFlight = ops;
    this.update({ status: 'saving' });
    this.options.save(this.state.version, ops).then(
      ({ version }) => {
        this.inFlight = null;
        this.update({ version, status: this.pending.length > 0 ? 'pending' : 'saved' });
        if (this.pending.length > 0) this.flush();
      },
      (error: unknown) => {
        const failed = this.inFlight ?? [];
        this.inFlight = null;
        // Back in front of the queue, unless a newer value for the same field is already pending.
        const newer = (op: PatchOp) =>
          op.op === 'set' && this.pending.some((p) => p.op === 'set' && p.path === op.path);
        this.pending = [...failed.filter((op) => !newer(op)), ...this.pending];
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

/** Where an op lands: an inserted item by its own path, anything else by `path`. */
function targetOf(op: PatchOp): string {
  return op.op === 'insert' ? `${op.path}.${(op.value as { id: string }).id}` : op.path;
}

/** Two paths touch when one contains the other. */
function touches(a: string, b: string): boolean {
  return isFieldPathWithin(a, b) || isFieldPathWithin(b, a);
}
