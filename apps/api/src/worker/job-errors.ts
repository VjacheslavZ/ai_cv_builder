import type { ErrorCode } from '@cv/shared';

/** A failure that retrying cannot fix: the job is marked failed and BullMQ does not retry. */
export class PermanentJobError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'PermanentJobError';
  }
}

/**
 * The DB job is no longer active (completed by another run, failed by the sweeper) or its CV
 * was deleted. The run stops quietly without writing anything (AC-5.9, NFR-R7).
 */
export class JobStopped extends Error {
  constructor() {
    super('Job is no longer active');
    this.name = 'JobStopped';
  }
}
