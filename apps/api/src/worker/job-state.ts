import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIVE_JOB_STATUSES,
  CV_WARNING_MESSAGES,
  jobErrorMessage,
  type CvDocument,
  type CvWarning,
  type ErrorCode,
  type JobStage,
} from '@cv/shared';
import { CvEventsPublisher } from '../events/cv-events.publisher.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { CvModel } from '../generated/prisma/models/Cv.js';
import type { JobModel } from '../generated/prisma/models/Job.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobStopped } from './job-errors.js';

export type ActiveJob = JobModel & { cv: CvModel };

const ACTIVE = { in: [...ACTIVE_JOB_STATUSES] };

/**
 * Every DB transition of a job, used by the processor and the sweeper. Jobs are at-least-once,
 * so each write is guarded by "the job is still active" (and the CV exists, which the cascade
 * from `cvs` to `jobs` implies). Writes that touch the CV lock the CV row first, then the job,
 * always in that order. Events are published only after commit.
 */
@Injectable()
export class JobState {
  private readonly logger = new Logger(JobState.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: CvEventsPublisher,
  ) {}

  /** Marks the job running for this attempt; `null` if it is gone or already finished. */
  async start(jobId: string, attempts: number): Promise<ActiveJob | null> {
    const { count } = await this.prisma.job.updateMany({
      where: { id: jobId, status: ACTIVE },
      data: { status: 'running', attempts },
    });
    if (count === 0) return null;
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { cv: true } });
    if (job) {
      await this.events.publish(job.cvId, { type: 'stage', jobId, stage: job.stage, attempts });
    }
    return job;
  }

  /** Update `Job.stage` → commit → publish. Throws `JobStopped` if the job is no longer active. */
  async enterStage(job: ActiveJob, stage: JobStage): Promise<void> {
    const { count } = await this.prisma.job.updateMany({
      where: { id: job.id, status: ACTIVE },
      data: { stage },
    });
    if (count === 0) throw new JobStopped();
    job.stage = stage;
    await this.events.publish(job.cvId, {
      type: 'stage',
      jobId: job.id,
      stage,
      attempts: job.attempts,
    });
  }

  /** Throws `JobStopped` unless the job is still active (and so its CV still exists). */
  async assertActive(jobId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (!job || !(ACTIVE_JOB_STATUSES as readonly string[]).includes(job.status)) {
      throw new JobStopped();
    }
  }

  /**
   * Saves the extracted PDF text and deletes the upload in one transaction (AC-4.1). If the
   * upload is already gone, another run got here first and nothing is written.
   */
  async savePdfText(job: ActiveJob, text: string): Promise<void> {
    await this.withLockedCv(job, async (tx) => {
      const { count } = await tx.pdfUpload.deleteMany({ where: { cvId: job.cvId } });
      if (count > 0) await tx.sourceText.create({ data: { cvId: job.cvId, kind: 'pdf', text } });
    });
  }

  /** The PDF had no text, but free text exists: drop the upload and keep a warning (AC-4.3). */
  async skipPdfWithWarning(job: ActiveJob): Promise<void> {
    const code: CvWarning['code'] = 'PDF_NO_TEXT_USED_FREE_TEXT';
    await this.withLockedCv(job, async (tx, cv) => {
      const { count } = await tx.pdfUpload.deleteMany({ where: { cvId: job.cvId } });
      const warnings = cv.warnings as unknown as CvWarning[];
      if (count > 0 && !warnings.some((w) => w.code === code)) {
        const warning: CvWarning = { code, message: CV_WARNING_MESSAGES[code] };
        await tx.cv.update({
          where: { id: job.cvId },
          data: { warnings: [...warnings, warning] as unknown as Prisma.InputJsonValue },
        });
      }
    });
  }

  /**
   * The result write (NFR-R6): under the CV row lock, the whole document, `version + 1`,
   * `aiRevision + 1`, CV `ready`, job `completed`. Throws `JobStopped` (and writes nothing) if
   * the job stopped being active or the CV was deleted.
   */
  async complete(job: ActiveJob, document: CvDocument): Promise<void> {
    const version = await this.withLockedCv(job, async (tx) => {
      const { count } = await tx.job.updateMany({
        where: { id: job.id, status: ACTIVE },
        data: { status: 'completed', stage: 'completed', errorCode: null, errorMessage: null },
      });
      if (count === 0) throw new JobStopped();
      const cv = await tx.cv.update({
        where: { id: job.cvId },
        data: {
          document: document as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          aiRevision: { increment: 1 },
          status: 'ready',
          failureCode: null,
        },
        select: { version: true },
      });
      return cv.version;
    });
    await this.events.publish(job.cvId, { type: 'completed', jobId: job.id, version });
  }

  /**
   * Fails an active job and, for a generation, its CV. Idempotent: returns `false` if the job
   * was already finished or is gone. `deleteUpload` drops the temporary PDF as well (a
   * permanent extraction failure, SPEC §1).
   */
  async fail(
    jobId: string,
    code: ErrorCode,
    options: { deleteUpload?: boolean } = {},
  ): Promise<boolean> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { cvId: true, type: true },
    });
    if (!job) return false;
    const message = jobErrorMessage(code);

    const failed = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cvs WHERE id = ${job.cvId}::uuid FOR UPDATE`;
      if (locked.length === 0) return false;
      if (options.deleteUpload) await tx.pdfUpload.deleteMany({ where: { cvId: job.cvId } });
      const { count } = await tx.job.updateMany({
        where: { id: jobId, status: ACTIVE },
        data: { status: 'failed', stage: 'failed', errorCode: code, errorMessage: message },
      });
      if (count === 0) return false;
      if (job.type === 'generate') {
        await tx.cv.update({
          where: { id: job.cvId },
          data: { status: 'failed', failureCode: code },
        });
      }
      return true;
    });

    if (failed) {
      this.logger.warn({ jobId, cvId: job.cvId, code }, 'Job failed');
      await this.events.publish(job.cvId, { type: 'failed', jobId, code, message });
    }
    return failed;
  }

  /** Runs `fn` in a transaction holding `SELECT … FOR UPDATE` on the CV; `JobStopped` if it is gone. */
  private async withLockedCv<T>(
    job: ActiveJob,
    fn: (tx: Prisma.TransactionClient, cv: CvModel) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cvs WHERE id = ${job.cvId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new JobStopped();
      const cv = await tx.cv.findUniqueOrThrow({ where: { id: job.cvId } });
      return fn(tx, cv);
    });
  }
}
