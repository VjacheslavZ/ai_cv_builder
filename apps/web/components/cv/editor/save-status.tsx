'use client';

import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import type { Autosave, AutosaveStatus } from '@/lib/autosave';

export function useAutosaveState(autosave: Autosave) {
  return useSyncExternalStore(autosave.subscribe, autosave.getState, autosave.getState);
}

const LABEL: Record<AutosaveStatus, string> = {
  idle: 'All changes saved',
  pending: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved: check your connection',
  conflict: 'Not saved',
};

/** "Saving… / Saved / Error" in a live region (AC-10.1). */
export function SaveStatus({ autosave }: { autosave: Autosave }) {
  const { status } = useAutosaveState(autosave);
  const busy = status === 'pending' || status === 'saving';
  const failed = status === 'error' || status === 'conflict';
  const Icon = busy ? LoaderCircleIcon : failed ? CircleAlertIcon : CircleCheckIcon;
  return (
    <p
      role="status"
      aria-live="polite"
      className={`flex items-center gap-1.5 text-xs ${failed ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      <Icon
        className={`size-3.5 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`}
        aria-hidden
      />
      {LABEL[status]}
      {status === 'error' && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => autosave.flush()}
        >
          Retry
        </Button>
      )}
    </p>
  );
}

/**
 * A real conflict (AC-10.4): the CV changed elsewhere in a place you also changed. Your typed
 * text is kept on screen; re-apply sends it on top of the current version.
 */
export function ConflictBanner({ autosave, onDiscard }: { autosave: Autosave; onDiscard(): void }) {
  const { status } = useAutosaveState(autosave);
  if (status !== 'conflict') return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm sm:flex-row sm:items-center"
    >
      <p className="flex-1">
        <strong className="font-medium">This CV was changed elsewhere.</strong> Your unsaved changes
        are still here.
      </p>
      <div className="flex gap-2">
        <Button className="h-11 sm:h-9" onClick={() => autosave.reapply()}>
          Re-apply my changes
        </Button>
        <Button variant="outline" className="h-11 sm:h-9" onClick={onDiscard}>
          Discard mine
        </Button>
      </div>
    </div>
  );
}
