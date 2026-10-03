import { GENERATE_STAGES, JOB_STAGES, type JobStage } from '@cv/shared';
import { cn } from 'cn';
import { CheckIcon, Loader2Icon } from 'lucide-react';

import type { ProgressJob } from '@/lib/cv-progress';

const STAGE_LABELS: Record<(typeof GENERATE_STAGES)[number], string> = {
  queued: 'Waiting to start',
  extracting: 'Reading your PDF',
  generating: 'Writing your CV',
  validating: 'Checking every fact against your source',
  completed: 'Done',
};

const order = (stage: JobStage) => JOB_STAGES.indexOf(stage);

/** The stages of a generation, with the current one announced via `aria-live` (AC-5.1, NFR-M8). */
export function GenerationStages({ job }: { job: ProgressJob | null }) {
  const current = job?.stage ?? 'queued';
  const retrying = (job?.attempts ?? 0) > 1;
  const currentLabel = STAGE_LABELS[current as keyof typeof STAGE_LABELS] ?? 'Working';

  return (
    <div className="flex flex-col gap-3">
      <p aria-live="polite" className="text-sm font-medium">
        {retrying ? 'Still working… ' : ''}
        {currentLabel}
      </p>
      <ol className="flex flex-col gap-2">
        {GENERATE_STAGES.map((stage) => {
          const done = order(stage) < order(current) || current === 'completed';
          const active = stage === current && current !== 'completed';
          return (
            <li
              key={stage}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm',
                active ? 'border-ring' : 'text-muted-foreground',
              )}
              aria-current={active ? 'step' : undefined}
            >
              <span className="flex size-5 items-center justify-center" aria-hidden>
                {done ? (
                  <CheckIcon className="size-4 text-primary" />
                ) : active ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                )}
              </span>
              <span className={cn(active && 'font-medium text-foreground')}>
                {STAGE_LABELS[stage]}
              </span>
              <span className="sr-only">{done ? '(done)' : active ? '(in progress)' : ''}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        You can leave this page: generation continues, and the CV appears on your dashboard on any
        device.
      </p>
    </div>
  );
}
