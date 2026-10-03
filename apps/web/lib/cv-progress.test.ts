import type { CvProgressDto, JobStatusDto } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { applyProgress, isInProgress, type ProgressState } from './cv-progress';

const cv: CvProgressDto = {
  id: 'cv-1',
  status: 'generating',
  version: 0,
  failureCode: null,
  failureMessage: null,
  warnings: [],
};

const job: JobStatusDto = {
  id: 'job-1',
  cvId: 'cv-1',
  type: 'generate',
  status: 'running',
  stage: 'generating',
  attempts: 1,
  errorCode: null,
  errorMessage: null,
  questionId: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
};

const running: ProgressState = { cv, job };

describe('applyProgress', () => {
  it('replaces everything with a snapshot', () => {
    const state = applyProgress({ cv: null, job: null }, { type: 'snapshot', cv, job });
    expect(state).toEqual(running);
    expect(isInProgress(state)).toBe(true);
  });

  it('moves stages forward and ignores late, older stages of the same attempt', () => {
    const validating = applyProgress(running, {
      type: 'stage',
      jobId: 'job-1',
      stage: 'validating',
      attempts: 1,
    });
    expect(validating.job?.stage).toBe('validating');
    const late = applyProgress(validating, {
      type: 'stage',
      jobId: 'job-1',
      stage: 'extracting',
      attempts: 1,
    });
    expect(late).toBe(validating);
  });

  it('accepts an earlier stage from a new attempt (a retry: "Still working…")', () => {
    const retry = applyProgress(running, {
      type: 'stage',
      jobId: 'job-1',
      stage: 'extracting',
      attempts: 2,
    });
    expect(retry.job).toMatchObject({ stage: 'extracting', attempts: 2 });
  });

  it('keeps a finished job finished', () => {
    const done = applyProgress(running, { type: 'completed', jobId: 'job-1', version: 1 });
    expect(done.cv).toMatchObject({ status: 'ready', version: 1 });
    expect(done.job).toMatchObject({ status: 'completed', stage: 'completed' });
    expect(isInProgress(done)).toBe(false);
    expect(
      applyProgress(done, { type: 'stage', jobId: 'job-1', stage: 'validating', attempts: 1 }),
    ).toBe(done);
    expect(applyProgress(done, { type: 'job_status', job })).toBe(done);
  });

  it('records a failure with its reason', () => {
    const failed = applyProgress(running, {
      type: 'failed',
      jobId: 'job-1',
      code: 'PDF_NO_TEXT',
      message: 'This PDF looks like a scan.',
    });
    expect(failed.cv).toMatchObject({ status: 'failed', failureCode: 'PDF_NO_TEXT' });
    expect(failed.job).toMatchObject({
      status: 'failed',
      errorMessage: 'This PDF looks like a scan.',
    });
  });

  it('catches up from the HTTP fallback after missing the completion event (AC-5.4)', () => {
    const state = applyProgress(running, {
      type: 'job_status',
      job: { ...job, status: 'completed', stage: 'completed' },
    });
    expect(state.cv?.status).toBe('ready');
    expect(isInProgress(state)).toBe(false);
  });

  it('ignores events of other jobs and heartbeats', () => {
    expect(applyProgress(running, { type: 'completed', jobId: 'other', version: 3 })).toBe(running);
    expect(applyProgress(running, { type: 'heartbeat' })).toBe(running);
  });
});
