'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { CvDraftPreview } from '@/components/cv/cv-draft-preview';
import { CvWarnings } from '@/components/cv/cv-notices';
import { CvPageShell } from '@/components/cv/cv-page-shell';
import { CvStatusBadge } from '@/components/cv/cv-status-badge';
import { GenerationFailed } from '@/components/cv/generation-failed';
import { GenerationStages } from '@/components/cv/generation-stages';
import { QuestionsList } from '@/components/cv/questions-list';
import { ApiRequestError } from '@/lib/api-fetch';
import { questionMarks } from '@/lib/question-marks';
import { cvQuery, cvsQuery } from '@/lib/queries/cvs';
import { useCvProgress } from '@/lib/use-cv-progress';

/** `/cvs/:id`: live stages while generating (AC-5.1), then the draft. */
export function CvProgressView({ cvId }: { cvId: string }) {
  const queryClient = useQueryClient();
  const { data: detail, error } = useQuery(cvQuery(cvId));
  const progress = useCvProgress(cvId, detail);
  const status = progress.cv?.status ?? detail?.status;

  // Finished: load the document and refresh the dashboard.
  useEffect(() => {
    if (!detail || !progress.cv || progress.cv.status === detail.status) return;
    void queryClient.invalidateQueries({ queryKey: cvQuery(cvId).queryKey });
    void queryClient.invalidateQueries({ queryKey: cvsQuery.queryKey, exact: true });
  }, [cvId, detail, progress.cv, queryClient]);

  if (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    const notFound = error instanceof ApiRequestError && error.status === 404;
    return (
      <CvPageShell title={notFound ? 'CV not found' : 'Could not load this CV'}>
        {notFound ? (
          <p className="text-muted-foreground">It may have been deleted.</p>
        ) : (
          <p className="text-destructive">Reload the page to try again.</p>
        )}
      </CvPageShell>
    );
  }
  if (!detail || !status) return <CvPageShell title="Loading…">{null}</CvPageShell>;

  return (
    <CvPageShell title={detail.title} badge={<CvStatusBadge status={status} />}>
      <CvWarnings warnings={progress.cv?.warnings ?? detail.warnings} />
      {status === 'generating' && <GenerationStages job={progress.job} />}
      {status === 'failed' && (
        <GenerationFailed
          cvId={cvId}
          failureCode={progress.cv?.failureCode ?? detail.failureCode}
          message={progress.cv?.failureMessage ?? detail.failureMessage}
          failedAt={detail.latestJob?.status === 'failed' ? detail.latestJob.updatedAt : null}
        />
      )}
      {status === 'ready' && detail.document && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <CvDraftPreview document={detail.document} marks={questionMarks(detail.questions)} />
          <div className="lg:sticky lg:top-4">
            <QuestionsList questions={detail.questions} />
          </div>
        </div>
      )}
    </CvPageShell>
  );
}
