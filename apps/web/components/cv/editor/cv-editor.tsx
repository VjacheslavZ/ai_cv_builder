'use client';

import {
  type AnswerResponse,
  type CvDetailDto,
  type CvDocument,
  type QuestionDto,
  type QuestionStatus,
} from '@cv/shared';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { memo, useCallback, useLayoutEffect, useMemo, useState } from 'react';

import { editorStatus, EditorStatusStore } from '@/lib/editor-status';
import { cvQuery, cvsQuery } from '@/lib/queries/cvs';
import { ContactEditor } from './contact-editor';
import { DownloadPdfButton } from './download-pdf-button';
import { EditorProvider } from './editor-context';
import { EducationEditor, ExperienceEditor, SkillsEditor, SummaryEditor } from './list-editors';
import { activeQuestions, QuestionsPanel } from './questions-panel';
import { ConflictBanner, SaveStatus } from './save-status';
import { SortableLists } from './sortable-lists';
import { useEditorSync } from './use-editor-sync';

type Tab = 'cv' | 'questions';

/**
 * The CV editor (FR-10) with its questions (FR-8, FR-9): every field autosaves, answers rewrite
 * one part at a time, and AI updates of other parts never interrupt typing (AC-10.4).
 */
export function CvEditor({ detail }: { detail: CvDetailDto & { document: CvDocument } }) {
  const queryClient = useQueryClient();
  const { form, autosave, flashed, refreshScope, discard } = useEditorSync(detail);
  const [tab, setTab] = useState<Tab>('cv');
  const open = detail.questions.filter((q) => q.status === 'open');

  // Fields subscribe to their own slice of the status (`useEditorStatus`), so the context value
  // stays the same: a new `detail` after every autosave re-renders no field, and an answered
  // question re-renders only the fields it touches. `set` ignores an equal status.
  const nextStatus = editorStatus(detail.questions, flashed);
  const [status] = useState(() => new EditorStatusStore(nextStatus));
  useLayoutEffect(() => status.set(nextStatus));
  const editor = useMemo(() => ({ form, autosave, status }), [form, autosave, status]);

  // Stable, so a question card re-renders only when its own question changes.
  const cvId = detail.id;
  const setStatus = useCallback(
    (question: QuestionDto, status: QuestionStatus) => {
      queryClient.setQueryData(
        cvQuery(cvId).queryKey,
        (d) =>
          d && {
            ...d,
            questions: d.questions.map((q) => (q.id === question.id ? { ...q, status } : q)),
          },
      );
      void queryClient.invalidateQueries({ queryKey: cvsQuery.queryKey, exact: true });
    },
    [cvId, queryClient],
  );
  const onAnswered = useCallback(
    (question: QuestionDto, result: AnswerResponse) => {
      setStatus(question, result.status);
      if (result.status === 'answered') void refreshScope(question.path);
    },
    [refreshScope, setStatus],
  );
  const onDismissed = useCallback(
    (question: QuestionDto) => setStatus(question, 'dismissed'),
    [setStatus],
  );

  return (
    <EditorProvider value={editor}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="View"
            className="flex gap-1 rounded-lg bg-muted p-1 lg:hidden"
          >
            {(['cv', 'questions'] as const).map((value) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className="min-h-11 rounded-md px-3 text-sm aria-selected:bg-background aria-selected:shadow-sm"
              >
                {value === 'cv' ? 'CV' : `Questions (${open.length})`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <SaveStatus autosave={autosave} />
            <DownloadPdfButton cvId={detail.id} autosave={autosave} />
          </div>
        </div>
        <ConflictBanner autosave={autosave} onDiscard={discard} />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <form
            noValidate
            onSubmit={(e) => e.preventDefault()}
            className={cn('flex min-w-0 flex-col gap-4', tab !== 'cv' && 'hidden lg:flex')}
          >
            <EditorSections />
          </form>
          <div className={cn('lg:sticky lg:top-4', tab !== 'questions' && 'hidden lg:block')}>
            <QuestionsPanel
              cvId={detail.id}
              questions={activeQuestions(detail.questions)}
              onAnswered={onAnswered}
              onDismissed={onDismissed}
            />
          </div>
        </div>
      </div>
    </EditorProvider>
  );
}

/** The form itself: re-rendered through the editor context only, never by `CvEditor`. */
const EditorSections = memo(function EditorSections() {
  return (
    <SortableLists>
      <ContactEditor />
      <SummaryEditor />
      <ExperienceEditor />
      <EducationEditor />
      <SkillsEditor />
    </SortableLists>
  );
});
