'use client';

import type { CvDocument } from '@cv/shared';
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { UseFormReturn } from 'react-hook-form';

import type { Autosave } from '@/lib/autosave';
import { isLocked, type EditorStatus, type EditorStatusStore } from '@/lib/editor-status';

/** Stable for the editor's lifetime: a change of status never re-renders every consumer. */
export interface EditorContextValue {
  form: UseFormReturn<CvDocument>;
  autosave: Autosave;
  status: EditorStatusStore;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export const EditorProvider = EditorContext.Provider;

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error('useEditor outside the CV editor');
  return value;
}

/**
 * One slice of the editor's status; the component re-renders only when the slice changes.
 * `select` must return a primitive (compared with `Object.is`).
 */
export function useEditorStatus<T extends string | boolean>(
  select: (status: EditorStatus) => T,
): T {
  const { status } = useEditor();
  const snapshot = () => select(status.get());
  return useSyncExternalStore(status.subscribe, snapshot, snapshot);
}

/** The field at `path` is read-only while the AI rewrites its part (AC-9.4). */
export function useLocked(path: string): boolean {
  return useEditorStatus((s) => isLocked(s, path));
}
