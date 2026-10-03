import {
  jobErrorMessage,
  type CvDetailDto,
  type CvDocument,
  type CvProgressDto,
  type CvWarning,
  type QuestionDto,
} from '@cv/shared';
import type { CvModel } from '../generated/prisma/models/Cv.js';
import type { JobModel } from '../generated/prisma/models/Job.js';
import type { QuestionModel } from '../generated/prisma/models/Question.js';
import { toErrorCode, toJobStatusDto } from '../jobs/job.mapper.js';

// JSON columns are written only by our own code after validation (the worker validates the
// document with `cvDocumentSchema`), so reading them back is a cast, not a parse.

export function toCvProgressDto(cv: CvModel): CvProgressDto {
  const failureCode = toErrorCode(cv.failureCode);
  return {
    id: cv.id,
    status: cv.status,
    version: cv.version,
    failureCode,
    failureMessage: failureCode ? jobErrorMessage(failureCode) : null,
    warnings: cv.warnings as unknown as CvWarning[],
  };
}

export function toQuestionDto(question: QuestionModel): QuestionDto {
  return {
    id: question.id,
    path: question.path,
    type: question.type,
    priority: question.priority,
    text: question.text,
    status: question.status,
    answer: question.answer,
  };
}

export function toCvDetailDto(
  cv: CvModel,
  questions: QuestionModel[],
  activeJobs: JobModel[],
  latestJob: JobModel | null,
): CvDetailDto {
  const progress = toCvProgressDto(cv);
  return {
    id: cv.id,
    title: cv.title,
    targetRole: cv.targetRole,
    status: progress.status,
    failureCode: progress.failureCode,
    failureMessage: progress.failureMessage,
    warnings: progress.warnings as CvWarning[],
    document: cv.document as unknown as CvDocument | null,
    version: cv.version,
    questions: questions.map(toQuestionDto),
    activeJobs: activeJobs.map(toJobStatusDto),
    latestJob: latestJob ? toJobStatusDto(latestJob) : null,
    createdAt: cv.createdAt.toISOString(),
    updatedAt: cv.updatedAt.toISOString(),
  };
}
