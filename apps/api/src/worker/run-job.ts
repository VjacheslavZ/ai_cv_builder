import type { Logger } from '@nestjs/common';
import { ErrorCode } from '@cv/shared';
import { UnrecoverableError } from 'bullmq';
import { LlmError } from '../llm/llm-client.js';
import type { CvBullJob } from '../queue/cv-queue.service.js';
import { JobStopped, PermanentJobError } from './job-errors.js';
import type { ActiveJob, JobState } from './job-state.js';

export interface RunJobOptions {
  state: JobState;
  logger: Logger;
  /** Extra cleanup for a permanent failure (e.g. drop the PDF upload). */
  failOptions?(code: ErrorCode): { deleteUpload?: boolean };
}

/**
 * One attempt of a job, shared by every processor (AC-5.5 – 5.7, NFR-R7): marks it running,
 * stops quietly if it is no longer active, fails it for good on `PermanentJobError`
 * (`UnrecoverableError`, no retry), and otherwise rethrows so BullMQ backs off and retries,
 * failing the DB job on the last attempt.
 */
export async function runJob(
  bullJob: CvBullJob,
  options: RunJobOptions,
  body: (job: ActiveJob) => Promise<void>,
): Promise<void> {
  const { state, logger } = options;
  const jobId = bullJob.data.jobId;
  const attempt = bullJob.attemptsMade + 1;
  const startedAt = Date.now();

  const job = await state.start(jobId, attempt);
  if (!job) {
    logger.log({ jobId }, 'Job is no longer active; skipped');
    return;
  }
  try {
    if (job.deadlineAt.getTime() <= Date.now()) throw new PermanentJobError(ErrorCode.JOB_TIMEOUT);
    await body(job);
    logger.log(
      { jobId, cvId: job.cvId, attempt, durationMs: Date.now() - startedAt },
      'Job completed',
    );
  } catch (err) {
    if (err instanceof JobStopped) {
      logger.log({ jobId, stage: job.stage }, 'Job stopped: no longer active or CV deleted');
      return;
    }
    if (err instanceof PermanentJobError) {
      await state.fail(jobId, err.code, options.failOptions?.(err.code));
      throw new UnrecoverableError(err.code);
    }
    const code = err instanceof LlmError ? ErrorCode.LLM_UNAVAILABLE : ErrorCode.INTERNAL;
    const attempts = bullJob.opts.attempts ?? 1;
    logger.warn(
      { jobId, stage: job.stage, attempt, attempts, err: (err as Error).name },
      'Job attempt failed',
    );
    // The last attempt: BullMQ will not retry, so the DB job fails now.
    if (attempt >= attempts) await state.fail(jobId, code);
    throw err;
  }
}

/**
 * One LLM call within the job's time budget (NFR-R3): retry layers multiply, so a call that no
 * longer fits before the deadline fails the job with `JOB_TIMEOUT`. A permanent LLM error fails
 * it at once (AC-5.6). Afterwards, stop if the job was cancelled meanwhile (AC-5.9).
 */
export async function callWithinDeadline<T>(
  job: ActiveJob,
  state: JobState,
  callMs: number,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (job.deadlineAt.getTime() - Date.now() < callMs) {
    throw new PermanentJobError(ErrorCode.JOB_TIMEOUT);
  }
  try {
    return await call(AbortSignal.timeout(callMs));
  } catch (err) {
    if (err instanceof LlmError && !err.retryable) {
      throw new PermanentJobError(ErrorCode.LLM_UNAVAILABLE);
    }
    throw err;
  } finally {
    await state.assertActive(job.id);
  }
}
