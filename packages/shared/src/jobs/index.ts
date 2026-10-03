import { ErrorCode } from '../errors/error-codes.js';

// Job lifecycle (docs/plans/README.md, cross-cutting conventions). Postgres holds the state the
// user sees; BullMQ only dispatches.

export const JOB_TYPES = ['generate', 'apply_answer'] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** `cancelled` only when Regenerate cancels `apply_answer` jobs; deleting a CV cascades instead. */
export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ACTIVE_JOB_STATUSES = ['queued', 'running'] as const satisfies readonly JobStatus[];

export function isActiveJobStatus(status: JobStatus): boolean {
  return (ACTIVE_JOB_STATUSES as readonly JobStatus[]).includes(status);
}

export const JOB_STAGES = [
  'queued',
  'extracting',
  'generating',
  'validating',
  'applying',
  'completed',
  'failed',
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

/** The stages of a `generate` job, in order, as the progress screen lists them. */
export const GENERATE_STAGES = [
  'queued',
  'extracting',
  'generating',
  'validating',
  'completed',
] as const satisfies readonly JobStage[];

/** `GET /api/jobs/:id`, the SSE snapshot, and `activeJobs` of `GET /api/cvs/:id`. */
export interface JobStatusDto {
  id: string;
  cvId: string;
  type: JobType;
  status: JobStatus;
  stage: JobStage;
  /** Attempts started so far; > 1 means the job is being retried ("Still working…"). */
  attempts: number;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  questionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Plain-language failure reasons shown to the user (AC-4.3, AC-5.6). */
export const JOB_ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.PDF_NO_TEXT]: 'This PDF looks like a scan. Paste your experience as text instead.',
  [ErrorCode.PDF_ENCRYPTED]:
    'This PDF is password-protected. Remove the password or paste your experience as text.',
  [ErrorCode.PDF_CORRUPTED]:
    'We could not read this PDF. Try exporting it again or paste your experience as text.',
  [ErrorCode.PDF_TOO_MANY_PAGES]:
    'This PDF has more than 10 pages. Upload a shorter CV or paste the relevant part as text.',
  [ErrorCode.PDF_EXPIRED]:
    'The uploaded PDF is no longer available. Create the CV again with the file or the text.',
  [ErrorCode.LLM_UNAVAILABLE]: 'The AI service is unavailable right now. Try again later.',
  [ErrorCode.LLM_INVALID_OUTPUT]: 'The AI returned an unusable draft. Try again.',
  [ErrorCode.JOB_TIMEOUT]: 'Generation took too long and was stopped. Try again.',
  [ErrorCode.INTERNAL]: 'Something went wrong while generating your CV. Try again.',
};

export function jobErrorMessage(code: ErrorCode): string {
  return JOB_ERROR_MESSAGES[code] ?? JOB_ERROR_MESSAGES[ErrorCode.INTERNAL]!;
}

// --- SSE: `GET /api/cvs/:id/events` ---
// Each event is one unnamed SSE message whose `data` is the JSON below; switch on `type`.

/** The CV fields the progress screen needs, read from Postgres on every (re)connect. */
export interface CvProgressDto {
  id: string;
  status: 'generating' | 'ready' | 'failed';
  version: number;
  failureCode: ErrorCode | null;
  failureMessage: string | null;
  warnings: { code: string; message: string }[];
}

export type CvEvent =
  /** Always the first event: the current state from Postgres (AC-5.1). */
  | { type: 'snapshot'; cv: CvProgressDto; job: JobStatusDto | null }
  | { type: 'stage'; jobId: string; stage: JobStage; attempts: number }
  | { type: 'completed'; jobId: string; version: number }
  | { type: 'failed'; jobId: string; code: ErrorCode; message: string }
  /** An AI write to one section (Phase 4). */
  | { type: 'section_updated'; path: string; version: number }
  | { type: 'heartbeat' };

export type CvEventType = CvEvent['type'];

/** Events the worker publishes on `cv:{cvId}:events` (everything but snapshot and heartbeat). */
export type PublishedCvEvent = Exclude<CvEvent, { type: 'snapshot' } | { type: 'heartbeat' }>;
