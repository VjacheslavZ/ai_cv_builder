import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ACTIVE_JOB_STATUSES, ErrorCode } from '@cv/shared';
import type { Redis } from 'ioredis';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CvQueueService } from '../queue/cv-queue.service.js';
import { InjectRedis } from '../redis/redis.module.js';
import { JobState } from './job-state.js';

/** Per BullMQ prefix, so separate deployments (and parallel test files) do not share it. */
export const sweeperLockKey = (prefix: string) => `${prefix}:lock:sweeper`;
const BATCH = 100;

/** Deletes the lock only if this instance still owns it. */
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

/**
 * Repairs the split between Postgres (job state) and BullMQ (dispatch), every
 * SWEEPER_INTERVAL_MS, in one worker at a time (a Redis lock with an owner token, released
 * after the pass and expiring after one interval if its owner dies). Every step is idempotent:
 * - re-enqueues jobs `queued` for longer than SWEEPER_REQUEUE_AFTER_MS, and `running` jobs that
 *   BullMQ no longer has, with `jobId` = DB id so nothing is duplicated (AC-5.7a);
 * - fails jobs past their deadline with `JOB_TIMEOUT` (NFR-R4);
 * - deletes PDF uploads older than PDF_RETENTION_MS (SPEC §1).
 */
@Injectable()
export class Sweeper implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(Sweeper.name);
  private readonly token = randomUUID();
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: CvQueueService,
    private readonly state: JobState,
    @InjectRedis() private readonly redis: Redis,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running ??= this.tick().finally(() => (this.running = undefined));
    }, this.config.timeouts.sweeperIntervalMs);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** One pass; public for tests. Skipped if another worker is sweeping right now. */
  async tick(): Promise<void> {
    const key = sweeperLockKey(this.config.queue.prefix);
    try {
      const ttl = this.config.timeouts.sweeperIntervalMs;
      if ((await this.redis.set(key, this.token, 'PX', ttl, 'NX')) !== 'OK') return;
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Sweeper skipped: Redis unavailable');
      return;
    }

    try {
      for (const step of [this.failExpired, this.requeueLost, this.deleteExpiredUploads]) {
        try {
          await step.call(this);
        } catch (err) {
          this.logger.warn({ step: step.name, err: (err as Error).message }, 'Sweeper step failed');
        }
      }
    } finally {
      await this.redis.eval(RELEASE_LOCK, 1, key, this.token).catch(() => undefined);
    }
  }

  private async failExpired(): Promise<void> {
    const expired = await this.prisma.job.findMany({
      where: { status: { in: [...ACTIVE_JOB_STATUSES] }, deadlineAt: { lte: new Date() } },
      select: { id: true },
      take: BATCH,
    });
    for (const { id } of expired) {
      if (await this.state.fail(id, ErrorCode.JOB_TIMEOUT)) await this.queue.removeIfWaiting(id);
    }
    if (expired.length) this.logger.warn({ count: expired.length }, 'Timed out jobs');
  }

  private async requeueLost(): Promise<void> {
    const queuedBefore = new Date(Date.now() - this.config.timeouts.sweeperRequeueAfterMs);
    const candidates = await this.prisma.job.findMany({
      where: {
        OR: [{ status: 'queued', createdAt: { lte: queuedBefore } }, { status: 'running' }],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true },
      take: BATCH,
    });

    let requeued = 0;
    for (const job of candidates) {
      const bullJob = await this.queue.getJob(job.id);
      if (!bullJob) {
        await this.queue.add(job.type, job.id);
        requeued++;
      } else if (await bullJob.isFailed()) {
        // BullMQ gave up but the failure never reached Postgres.
        await this.state.fail(job.id, ErrorCode.INTERNAL);
      }
    }
    if (requeued) this.logger.warn({ count: requeued }, 'Re-enqueued lost jobs');
  }

  private async deleteExpiredUploads(): Promise<void> {
    const { count } = await this.prisma.pdfUpload.deleteMany({
      where: { createdAt: { lte: new Date(Date.now() - this.config.timeouts.pdfRetentionMs) } },
    });
    if (count) this.logger.log({ count }, 'Deleted expired PDF uploads');
  }
}
