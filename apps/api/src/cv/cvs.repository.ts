import { Injectable } from '@nestjs/common';
import { ACTIVE_JOB_STATUSES, type CreateCvResponse, type CvSummaryDto } from '@cv/shared';
import { toErrorCode } from '../jobs/job.mapper.js';
import type { CvModel } from '../generated/prisma/models/Cv.js';
import type { QuestionModel } from '../generated/prisma/models/Question.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Db = PrismaService | Prisma.TransactionClient;

/** Every method takes the session's `userId` (see `common/ownership/owned.ts`). */
@Injectable()
export class CvsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listOwned(userId: string): Promise<CvSummaryDto[]> {
    const rows = await this.prisma.cv.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        failureCode: true,
        updatedAt: true,
        _count: { select: { questions: { where: { status: 'open' } } } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      failureCode: toErrorCode(row.failureCode),
      openQuestions: row._count.questions,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  findOwned(id: string, userId: string): Promise<CvModel | null> {
    return this.prisma.cv.findFirst({ where: { id, userId } });
  }

  /** The owned CV under `SELECT … FOR UPDATE` in the caller's transaction, or `null`. */
  async lockOwned(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
  ): Promise<CvModel | null> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM cvs WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
    return locked.length > 0 ? tx.cv.findUnique({ where: { id } }) : null;
  }

  listQuestions(cvId: string): Promise<QuestionModel[]> {
    return this.prisma.question.findMany({
      where: { cvId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** The CV and first job created under an `Idempotency-Key` (AC-3.4). */
  async findCreated(
    db: Db,
    userId: string,
    idempotencyKey: string,
  ): Promise<CreateCvResponse | null> {
    const cv = await db.cv.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      select: {
        id: true,
        jobs: {
          where: { type: 'generate' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { id: true },
        },
      },
    });
    const jobId = cv?.jobs[0]?.id;
    return cv && jobId ? { cvId: cv.id, jobId } : null;
  }

  /**
   * Deletes the CV and, by cascade, everything under it (AC-12.3). Returns the ids of the jobs
   * that were still active so the caller can drop them from the queue, or `null` if the CV does
   * not exist or is not owned.
   */
  async deleteOwned(id: string, userId: string): Promise<{ activeJobIds: string[] } | null> {
    return this.prisma.$transaction(async (tx) => {
      const jobs = await tx.job.findMany({
        where: { cvId: id, userId, status: { in: [...ACTIVE_JOB_STATUSES] } },
        select: { id: true },
      });
      const { count } = await tx.cv.deleteMany({ where: { id, userId } });
      return count === 0 ? null : { activeJobIds: jobs.map((job) => job.id) };
    });
  }
}
