'use client';

import { applyScopeFor, type CvDetailDto, type CvDocument, type CvEvent } from '@cv/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Autosave } from '@/lib/autosave';
import { overlayUnsaved, sectionOf, takeScope } from '@/lib/editor-sync';
import { cvQuery } from '@/lib/queries/cvs';
import { patchCv } from '@/lib/queries/editing';
import { useCvEvents } from '@/lib/use-cv-events';

const FLASH_MS = 2_500;

/**
 * The editor's state: one form over the document, autosave, and the server changes that land
 * in it (AI rewrites, simple answers, conflicts) without touching what the user is typing.
 */
export function useEditorSync(detail: CvDetailDto & { document: CvDocument }) {
  const cvId = detail.id;
  const queryClient = useQueryClient();
  const form = useForm<CvDocument>({ defaultValues: detail.document });
  const [flashed, setFlashed] = useState<string[]>([]);

  const [autosave] = useState(
    () =>
      new Autosave({
        version: detail.version,
        save: async (baseVersion, ops) => {
          const result = await patchCv(cvId, baseVersion, ops);
          queryClient.setQueryData(
            cvQuery(cvId).queryKey,
            (d) =>
              d && {
                ...d,
                version: result.version,
                questions: d.questions.map((q) =>
                  result.resolvedQuestionIds.includes(q.id)
                    ? { ...q, status: 'resolved' as const }
                    : q,
                ),
              },
          );
          return result;
        },
      }),
  );

  const flash = useCallback((scope: string) => {
    setFlashed((list) => [...list, scope]);
    setTimeout(() => setFlashed((list) => list.filter((s) => s !== scope)), FLASH_MS);
  }, []);

  /** The server changed `scope` (now `fresh`): take that part, keep everything unsaved. */
  const applyServerChange = useCallback(
    (scope: string, fresh: CvDetailDto) => {
      const section = sectionOf(scope);
      if (!fresh.document || !section) return;
      const local = form.getValues();
      const next = overlayUnsaved(
        takeScope(local, fresh.document, scope),
        local,
        autosave.unsavedPaths(),
      );
      form.setValue(section, next[section] as never, { shouldDirty: false });
      autosave.rebase({ version: fresh.version, document: fresh.document }, scope);
      flash(scope);
    },
    [autosave, flash, form],
  );

  const refetch = useCallback(async () => {
    const before = queryClient.getQueryData(cvQuery(cvId).queryKey);
    const fresh = await queryClient.fetchQuery({ ...cvQuery(cvId), staleTime: 0 });
    // Answers applied since the last look (the event may have been missed).
    for (const q of before?.questions ?? []) {
      const now = fresh.questions.find((x) => x.id === q.id);
      const scope = applyScopeFor(q.path);
      if (q.status === 'applying' && now?.status === 'answered' && scope) {
        applyServerChange(scope, fresh);
      }
    }
    return fresh;
  }, [applyServerChange, cvId, queryClient]);

  /** After a simple answer (written by the server): take that field. */
  const refreshScope = useCallback(
    async (scope: string) => {
      const fresh = await queryClient.fetchQuery({ ...cvQuery(cvId), staleTime: 0 });
      applyServerChange(scope, fresh);
    },
    [applyServerChange, cvId, queryClient],
  );

  const applying = detail.questions.some((q) => q.status === 'applying');
  useCvEvents(cvId, applying, {
    onEvent: (event: CvEvent) => {
      if (event.type === 'section_updated' || event.type === 'question_failed') void refetch();
      if (event.type === 'snapshot' && event.cv.version !== autosave.getState().version) {
        void refetch();
      }
    },
    onPoll: () => void refetch(),
  });

  // A real conflict: show the server's state, with every unsaved value kept on screen.
  const conflictVersion = useRef<number | null>(null);
  useEffect(
    () =>
      autosave.subscribe(() => {
        const { conflict } = autosave.getState();
        if (!conflict || conflictVersion.current === conflict.version) return;
        conflictVersion.current = conflict.version;
        form.reset(overlayUnsaved(conflict.document, form.getValues(), autosave.unsavedPaths()));
      }),
    [autosave, form],
  );

  const discard = useCallback(() => {
    const { conflict } = autosave.getState();
    if (conflict) form.reset(conflict.document);
    autosave.discard();
  }, [autosave, form]);

  // Save before the tab goes away (NFR-M5).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') autosave.flush();
    };
    const onPageHide = () => autosave.flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      autosave.flush();
    };
  }, [autosave]);

  return { form, autosave, flashed, refreshScope, discard };
}
