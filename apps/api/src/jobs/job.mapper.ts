import { isErrorCode, type ErrorCode, type JobStatusDto } from '@cv/shared';
import type { JobModel } from '../generated/prisma/models/Job.js';

export function toErrorCode(code: string | null): ErrorCode | null {
  return code !== null && isErrorCode(code) ? code : null;
}

export function toJobStatusDto(job: JobModel): JobStatusDto {
  return {
    id: job.id,
    cvId: job.cvId,
    type: job.type,
    status: job.status,
    stage: job.stage,
    attempts: job.attempts,
    errorCode: toErrorCode(job.errorCode),
    errorMessage: job.errorMessage,
    questionId: job.questionId,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
