import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { JobType } from '@cv/shared';
import { Queue, type Job as BullJob, type JobsOptions } from 'bullmq';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { RedisConnectionFactory } from '../redis/redis.connection-factory.js';

export const CV_QUEUE_NAME = 'cv-jobs';

/** The whole BullMQ payload: ids only (NFR-R1). Everything else is read from Postgres. */
export interface CvJobPayload {
  jobId: string;
}

export type CvBullJob = BullJob<CvJobPayload, void, JobType>;

/**
 * The producer side of `cv-jobs`, shared by the API (enqueue after commit, remove on delete)
 * and the worker's sweeper (re-enqueue). The BullMQ `jobId` is always the DB job id, so adding
 * the same job twice is a no-op (NFR-R7).
 */
@Injectable()
export class CvQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(CvQueueService.name);
  readonly queue: Queue<CvJobPayload, void, JobType>;

  constructor(
    @InjectConfig() private readonly config: AppConfig,
    connections: RedisConnectionFactory,
  ) {
    this.queue = new Queue(CV_QUEUE_NAME, {
      connection: connections.create('bullmq', 'queue'),
      prefix: config.queue.prefix,
      // Fail fast instead of waiting for Redis: callers fall back to the sweeper.
      skipWaitingForReady: true,
    });
    this.queue.on('error', (err: Error) => {
      this.logger.warn({ err: err.message }, 'Queue error');
    });
  }

  get jobOptions(): JobsOptions {
    return {
      attempts: this.config.limits.jobAttempts,
      backoff: { type: 'exponential', delay: this.config.timeouts.jobBackoffMs, jitter: 0.5 },
      removeOnComplete: true,
      removeOnFail: { age: 24 * 60 * 60 },
    };
  }

  /** Adds the job; resolves once Redis acknowledged it. */
  async add(type: JobType, jobId: string): Promise<void> {
    await this.queue.add(type, { jobId }, { ...this.jobOptions, jobId });
  }

  /**
   * Enqueue right after the DB commit. Never throws and never waits longer than
   * ENQUEUE_TIMEOUT_MS: a job that did not make it is re-enqueued by the sweeper (AC-5.7a).
   */
  async addAfterCommit(type: JobType, jobId: string): Promise<boolean> {
    try {
      await this.bounded(this.add(type, jobId));
      return true;
    } catch (err) {
      // A late `add` still lands with the same jobId, which makes the sweeper's re-add a no-op.
      this.logger.warn(
        { jobId, err: (err as Error).message },
        'Enqueue failed; left to the sweeper',
      );
      return false;
    }
  }

  /** BullMQ commands wait for Redis indefinitely; HTTP paths give up after ENQUEUE_TIMEOUT_MS. */
  private async bounded<T>(promise: Promise<T>): Promise<T> {
    promise.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Redis timed out')),
        this.config.timeouts.enqueueMs,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  getJob(jobId: string): Promise<CvBullJob | undefined> {
    return this.queue.getJob(jobId);
  }

  /** Removes a job that has not started (on CV delete). An active (locked) job is left alone. */
  async removeIfWaiting(jobId: string): Promise<void> {
    try {
      await this.bounded(
        (async () => {
          const job = await this.queue.getJob(jobId);
          if (job && !(await job.isActive())) await job.remove();
        })(),
      );
    } catch (err) {
      // Locked by a worker, or Redis is down: the worker's own checks stop it (AC-5.9).
      this.logger.debug({ jobId, err: (err as Error).message }, 'Could not remove job');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close().catch(() => undefined);
  }
}
