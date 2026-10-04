'use client';

import { isFieldPathWithin, type CvDocument } from '@cv/shared';
import { createContext, useContext } from 'react';
import type { UseFormReturn } from 'react-hook-form';

import type { Autosave } from '@/lib/autosave';
import type { QuestionMarks } from '@/lib/question-marks';

export interface EditorContextValue {
  form: UseFormReturn<CvDocument>;
  autosave: Autosave;
  marks: QuestionMarks;
  /** Entries or sections an `apply_answer` job is rewriting: read-only until it ends (AC-9.4). */
  lockedScopes: string[];
  /** Parts the AI just rewrote, highlighted for a moment (AC-9.1). */
  flashed: string[];
}

const EditorContext = createContext<EditorContextValue | null>(null);

export const EditorProvider = EditorContext.Provider;

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error('useEditor outside the CV editor');
  return value;
}

/** The scope rewriting `path`, if any: the field is read-only while it runs. */
export function lockingScope(lockedScopes: string[], path: string): string | undefined {
  return lockedScopes.find((scope) => isFieldPathWithin(path, scope));
}
