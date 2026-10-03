import { Injectable } from '@nestjs/common';
import { ACTIVE_JOB_STATUSES, ErrorCode } from '@cv/shared';
import { ApiException } from '../common/errors/api.exception.js';
import { Prisma } from '../generated/prisma/client.js';
import type { JobModel } from '../generated/prisma/models/Job.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * `jobs` has two unique indexes: the generated primary key and the partial index
 * `jobs_one_active_generation_per_cv`. On insert, a unique violation is the latter.
 */
function isActiveGenerationConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Read side for the API. Every method takes the session's `userId`. */
@Injectable()
export class JobsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOwned(id: string, userId: string): Promise<JobModel | null> {
    return this.prisma.job.findFirst({ where: { id, userId } });
  }

  listActiveForCv(cvId: string): Promise<JobModel[]> {
    return this.prisma.job.findMany({
      where: { cvId, status: { in: [...ACTIVE_JOB_STATUSES] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * A queued `generate` job for the CV, inside the caller's transaction. A second active
   * generation is `409 ACTIVE_JOB_EXISTS` with the existing job's id (AC-5.8). The insert runs
   * in a savepoint so the conflict does not abort the caller's transaction.
   */
  async createGenerateJob(
    tx: Prisma.TransactionClient,
    data: { cvId: string; userId: string; deadlineAt: Date },
  ): Promise<{ id: string }> {
    await tx.$executeRaw`SAVEPOINT create_generate_job`;
    try {
      const job = await tx.job.create({
        data: { ...data, type: 'generate' },
        select: { id: true },
      });
      await tx.$executeRaw`RELEASE SAVEPOINT create_generate_job`;
      return job;
    } catch (err) {
      if (!isActiveGenerationConflict(err)) throw err;
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT create_generate_job`;
      const active = await tx.job.findFirst({
        where: { cvId: data.cvId, type: 'generate', status: { in: [...ACTIVE_JOB_STATUSES] } },
        select: { id: true },
      });
      throw new ApiException(ErrorCode.ACTIVE_JOB_EXISTS, 'This CV is already being generated', {
        jobId: active?.id,
      });
    }
  }

  latestForCv(cvId: string): Promise<JobModel | null> {
    return this.prisma.job.findFirst({ where: { cvId }, orderBy: { createdAt: 'desc' } });
  }
}
