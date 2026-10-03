import { Injectable, Logger } from '@nestjs/common';
import type { CreateCvResponse, CvDetailDto, CvProgressDto, JobStatusDto } from '@cv/shared';
import { ownedOrNotFound } from '../common/ownership/owned.js';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { Prisma } from '../generated/prisma/client.js';
import { toJobStatusDto } from '../jobs/job.mapper.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CvQueueService } from '../queue/cv-queue.service.js';
import { GenerationLimits } from '../rate-limit/generation-limits.js';
import { toCvDetailDto, toCvProgressDto } from './cv.mapper.js';
import { CvsRepository } from './cvs.repository.js';

export interface CreateCvCommand {
  userId: string;
  role: string;
  text?: string;
  /** Already checked for size, MIME type, and the `%PDF-` signature. */
  pdf?: Buffer;
  idempotencyKey?: string;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Injectable()
export class CvsService {
  private readonly logger = new Logger(CvsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cvs: CvsRepository,
    private readonly jobs: JobsRepository,
    private readonly queue: CvQueueService,
    private readonly limits: GenerationLimits,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async create(command: CreateCvCommand): Promise<CreateCvResponse> {
    const { userId, idempotencyKey } = command;

    if (idempotencyKey) {
      const existing = await this.cvs.findCreated(this.prisma, userId, idempotencyKey);
      if (existing) return existing;
    }

    let created: CreateCvResponse;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Takes the per-user lock, so a concurrent replay waits here and then sees the first
        // request's row instead of a full slot count.
        await this.limits.assertActiveSlot(tx, userId);
        if (idempotencyKey) {
          const existing = await this.cvs.findCreated(tx, userId, idempotencyKey);
          if (existing) return existing;
        }
        // Last check, so a request rejected for another reason does not use up the hour.
        await this.limits.consumeHourly(userId);
        const cv = await tx.cv.create({
          data: {
            userId,
            title: command.role,
            targetRole: command.role,
            idempotencyKey: idempotencyKey ?? null,
            ...(command.text
              ? { sources: { create: { kind: 'free_text', text: command.text } } }
              : {}),
            ...(command.pdf
              ? { pdfUpload: { create: { bytes: new Uint8Array(command.pdf) } } }
              : {}),
          },
          select: { id: true },
        });
        const job = await this.jobs.createGenerateJob(tx, {
          cvId: cv.id,
          userId,
          deadlineAt: new Date(Date.now() + this.config.timeouts.jobDeadlineMs),
        });
        return { cvId: cv.id, jobId: job.id };
      });
    } catch (err) {
      // Lost the race on (userId, idempotencyKey) to a request that committed first.
      if (idempotencyKey && isUniqueViolation(err)) {
        const existing = await this.cvs.findCreated(this.prisma, userId, idempotencyKey);
        if (existing) return existing;
      }
      throw err;
    }

    await this.queue.addAfterCommit('generate', created.jobId);
    this.logger.log({ cvId: created.cvId, jobId: created.jobId }, 'CV created');
    return created;
  }

  async get(id: string, userId: string): Promise<CvDetailDto> {
    const cv = ownedOrNotFound(await this.cvs.findOwned(id, userId));
    const [questions, activeJobs, latestJob] = await Promise.all([
      this.cvs.listQuestions(cv.id),
      this.jobs.listActiveForCv(cv.id),
      this.jobs.latestForCv(cv.id),
    ]);
    return toCvDetailDto(cv, questions, activeJobs, latestJob);
  }

  /** The SSE snapshot (AC-5.1); `null` once the CV is gone. */
  async progress(
    id: string,
    userId: string,
  ): Promise<{ cv: CvProgressDto; job: JobStatusDto | null } | null> {
    const cv = await this.cvs.findOwned(id, userId);
    if (!cv) return null;
    const job = await this.jobs.latestForCv(cv.id);
    return { cv: toCvProgressDto(cv), job: job ? toJobStatusDto(job) : null };
  }

  /** AC-12.3 / AC-5.9: rows go by cascade; waiting queue entries are dropped too. */
  async delete(id: string, userId: string): Promise<void> {
    const { activeJobIds } = ownedOrNotFound(await this.cvs.deleteOwned(id, userId));
    await Promise.all(activeJobIds.map((jobId) => this.queue.removeIfWaiting(jobId)));
    this.logger.log({ cvId: id, cancelledJobs: activeJobIds.length }, 'CV deleted');
  }
}
