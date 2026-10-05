import { ErrorCode } from '@cv/shared';
import { ApiRequestError } from './api-fetch';

// When the live PDF preview (AC-11.7) loads which version. Plain TypeScript, no React, so every
// rule is unit-tested. The preview shows the saved document only: it loads once autosave has
// settled and the saved version has moved past the one on screen, one request at a time. A PDF
// is fetched first (so a 429 or a failed render never replaces the page on screen), then handed
// to a hidden frame as `incoming`; it becomes `shown` when that frame has loaded it.

export type PreviewStatus = 'idle' | 'loading' | 'paused' | 'error';

export interface PreviewPdf {
  version: number;
  url: string;
}

export interface PreviewState {
  /** The PDF on screen. */
  shown: PreviewPdf | null;
  /** A newer PDF, fetched, waiting for its frame to load. */
  incoming: PreviewPdf | null;
  /** `paused`: the per-minute limit (NFR-S9); `error`: this version failed to render. */
  status: PreviewStatus;
}

export interface PdfPreviewOptions {
  fetchPdf(signal: AbortSignal): Promise<Blob>;
  /** `URL.createObjectURL` / `URL.revokeObjectURL`, replaced in tests. */
  toUrl(blob: Blob): string;
  revoke(url: string): void;
  /** Quiet time after the last save before a reload; the first load does not wait. */
  settleMs?: number;
  now?(): number;
}

const MINUTE_MS = 60_000;

export class PdfPreview {
  private state: PreviewState = { shown: null, incoming: null, status: 'idle' };
  private readonly listeners = new Set<() => void>();
  /** The newest version seen while autosave was settled. */
  private latest: number | null = null;
  private settled = false;
  private inFlight: { version: number; controller: AbortController } | null = null;
  private failedVersion: number | null = null;
  private pausedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly settleMs: number;
  private readonly now: () => number;

  constructor(private readonly options: PdfPreviewOptions) {
    this.settleMs = options.settleMs ?? 1_500;
    this.now = options.now ?? Date.now;
  }

  getState = (): PreviewState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * The autosave state changed: `version` is the last saved one, `settled` is true when nothing
   * is pending, saving, or in conflict. A reload is planned only while settled.
   */
  update(version: number, settled: boolean): void {
    this.settled = settled;
    clearTimeout(this.timer);
    if (!settled) return;
    if (this.latest === null || version > this.latest) this.latest = version;
    this.plan();
  }

  /** The frame showing `url` has loaded: it replaces the PDF on screen. */
  displayed(url: string): void {
    const incoming = this.state.incoming;
    if (!incoming || incoming.url !== url) return;
    if (this.state.shown) this.options.revoke(this.state.shown.url);
    this.set({ shown: incoming, incoming: null, status: this.inFlight ? 'loading' : 'idle' });
    this.plan();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.inFlight?.controller.abort();
    for (const pdf of [this.state.shown, this.state.incoming]) {
      if (pdf) this.options.revoke(pdf.url);
    }
    this.listeners.clear();
  }

  /** The version on screen or on its way there. */
  private current(): number {
    return (
      this.inFlight?.version ?? this.state.incoming?.version ?? this.state.shown?.version ?? -1
    );
  }

  private plan(): void {
    clearTimeout(this.timer);
    const version = this.latest;
    if (this.disposed || !this.settled || version === null) return;
    if (this.inFlight || version <= this.current() || version === this.failedVersion) return;
    const first = !this.state.shown && !this.state.incoming;
    const delay = Math.max(first ? 0 : this.settleMs, this.pausedUntil - this.now());
    this.timer = setTimeout(() => this.load(version), delay);
  }

  private load(version: number): void {
    const controller = new AbortController();
    this.inFlight = { version, controller };
    this.set({ status: 'loading' });
    this.options.fetchPdf(controller.signal).then(
      (blob) => {
        this.inFlight = null;
        if (this.disposed) return;
        // A newer PDF replaces one still waiting for its frame.
        if (this.state.incoming) this.options.revoke(this.state.incoming.url);
        this.failedVersion = null;
        this.set({ incoming: { version, url: this.options.toUrl(blob) } });
      },
      (error: unknown) => {
        this.inFlight = null;
        if (this.disposed) return;
        if (error instanceof ApiRequestError && error.code === ErrorCode.RATE_LIMITED) {
          const now = this.now();
          this.pausedUntil = now - (now % MINUTE_MS) + MINUTE_MS;
          this.set({ status: 'paused' });
        } else {
          this.failedVersion = version;
          this.set({ status: 'error' });
        }
        this.plan();
      },
    );
  }

  private set(patch: Partial<PreviewState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
