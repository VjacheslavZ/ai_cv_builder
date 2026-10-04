import {
  JOB_STAGES,
  type CvDetailDto,
  type CvEvent,
  type CvProgressDto,
  type JobStatusDto,
} from '@cv/shared';

// The progress screen's state, fed by SSE events, the `GET /api/jobs/:id` fallback, and the
// initial `GET /api/cvs/:id`. Kept free of React so it can be unit-tested (AC-5.4).

export type ProgressJob = Pick<
  JobStatusDto,
  'id' | 'status' | 'stage' | 'attempts' | 'errorCode' | 'errorMessage'
>;

export interface ProgressState {
  cv: CvProgressDto | null;
  job: ProgressJob | null;
}

export type ProgressAction =
  | CvEvent
  /** A job read over HTTP (fallback while SSE is down). */
  | { type: 'job_status'; job: JobStatusDto }
  /** The state from `GET /api/cvs/:id`. */
  | { type: 'reset'; state: ProgressState };

export const initialProgress: ProgressState = { cv: null, job: null };

const isTerminal = (job: ProgressJob | null) =>
  job !== null && job.status !== 'queued' && job.status !== 'running';

const stageIndex = (stage: ProgressJob['stage']) => JOB_STAGES.indexOf(stage);

export function progressFromDetail(detail: CvDetailDto): ProgressState {
  return {
    cv: {
      id: detail.id,
      status: detail.status,
      version: detail.version,
      failureCode: detail.failureCode,
      failureMessage: detail.failureMessage,
      warnings: detail.warnings,
    },
    job: detail.latestJob,
  };
}

/**
 * Applies events monotonically: events can arrive late (sent right after a snapshot, or a
 * fallback response racing the stream), so a stage never moves backwards within one attempt
 * and a finished job stays finished.
 */
export function applyProgress(state: ProgressState, action: ProgressAction): ProgressState {
  switch (action.type) {
    case 'snapshot':
      return { cv: action.cv, job: action.job };

    case 'reset':
      return action.state;

    case 'job_status': {
      const job = action.job;
      if (state.job && state.job.id !== job.id) return state;
      if (isTerminal(state.job) && !isTerminal(job)) return state;
      const cv = state.cv && {
        ...state.cv,
        ...(job.status === 'completed' ? { status: 'ready' as const } : {}),
        ...(job.status === 'failed'
          ? {
              status: 'failed' as const,
              failureCode: job.errorCode,
              failureMessage: job.errorMessage,
            }
          : {}),
      };
      return { cv, job };
    }

    case 'stage': {
      const job = state.job;
      if (!job || job.id !== action.jobId || isTerminal(job)) return state;
      const newAttempt = action.attempts > job.attempts;
      if (!newAttempt && stageIndex(action.stage) < stageIndex(job.stage)) return state;
      return {
        ...state,
        job: {
          ...job,
          status: 'running',
          stage: action.stage,
          attempts: Math.max(job.attempts, action.attempts),
        },
      };
    }

    case 'completed': {
      if (!state.job || state.job.id !== action.jobId) return state;
      return {
        cv: state.cv && {
          ...state.cv,
          status: 'ready',
          version: action.version,
          failureCode: null,
          failureMessage: null,
        },
        job: {
          ...state.job,
          status: 'completed',
          stage: 'completed',
          errorCode: null,
          errorMessage: null,
        },
      };
    }

    case 'failed': {
      if (!state.job || state.job.id !== action.jobId) return state;
      return {
        cv: state.cv && {
          ...state.cv,
          status: 'failed',
          failureCode: action.code,
          failureMessage: action.message,
        },
        job: {
          ...state.job,
          status: 'failed',
          stage: 'failed',
          errorCode: action.code,
          errorMessage: action.message,
        },
      };
    }

    // Answers being applied (Phase 4) are the editor's business, not the generation's.
    case 'heartbeat':
    case 'section_updated':
    case 'question_failed':
      return state;
  }
}

/** True while there is something to watch. */
export function isInProgress(state: ProgressState): boolean {
  return state.cv?.status === 'generating' || (state.job !== null && !isTerminal(state.job));
}
