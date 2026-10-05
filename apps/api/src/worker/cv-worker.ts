import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ErrorCode, type JobType } from '@cv/shared';
import { UnrecoverableError, Worker } from 'bullmq';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { CV_QUEUE_NAME, type CvBullJob, type CvJobPayload } from '../queue/cv-queue.service.js';
import { RedisConnectionFactory } from '../redis/redis.connection-factory.js';
import { ApplyAnswerProcessor } from './apply/apply-answer.processor.js';
import { GenerateProcessor } from './generate.processor.js';
import { JobState } from './job-state.js';

/**
 * The BullMQ `Worker` on `cv-jobs`. `lockDuration` stays near the default: BullMQ renews the
 * lock every `lockDuration / 2` while the event loop is free (PDF parsing runs in a worker
 * thread), and a crashed worker's job is picked up by stalled detection (AC-5.7).
 */
@Injectable()
export class CvWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(CvWorker.name);
  private worker?: Worker<CvJobPayload, void, JobType>;

  constructor(
    @InjectConfig() private readonly config: AppConfig,
    private readonly connections: RedisConnectionFactory,
    private readonly generate: GenerateProcessor,
    private readonly applyAnswer: ApplyAnswerProcessor,
    private readonly state: JobState,
  ) {}

  onApplicationBootstrap(): void {
    const { timeouts, limits, queue } = this.config;
    const worker = new Worker<CvJobPayload, void, JobType>(
      CV_QUEUE_NAME,
      (job, token) => this.dispatch(job, token),
      {
        connection: this.connections.create('bullmq', 'worker'),
        prefix: queue.prefix,
        concurrency: limits.workerConcurrency,
        lockDuration: timeouts.workerLockMs,
        stalledInterval: timeouts.workerStalledIntervalMs,
        maxStalledCount: limits.workerMaxStalledCount,
      },
    );
    worker.on('failed', (job, err) => void this.onFailed(job, err));
    worker.on('stalled', (jobId, prev) => {
      this.logger.warn({ jobId, prev }, 'Job stalled; returned to the queue');
    });
    worker.on('error', (err) => {
      this.logger.warn({ err: err.message }, 'Worker error');
    });
    this.worker = worker;
  }

  private dispatch(job: CvBullJob, token: string | undefined): Promise<void> {
    switch (job.name) {
      case 'generate':
        return this.generate.process(job);
      case 'apply_answer':
        if (!token) throw new UnrecoverableError('apply_answer needs a job token');
        return this.applyAnswer.process(job, token);
      default:
        throw new UnrecoverableError(`Unsupported job type: ${job.name}`);
    }
  }

  /**
   * A final failure the processor could not record itself, e.g. a job that stalled more than
   * `maxStalledCount` times. `fail` is a no-op when the DB job is already finished.
   */
  private async onFailed(job: CvBullJob | undefined, err: Error): Promise<void> {
    if (!job || job.finishedOn === undefined) return; // will be retried
    // Thrown by the processor after it already marked the DB job failed.
    if (err.name === 'UnrecoverableError') return;
    try {
      await this.state.fail(job.data.jobId, ErrorCode.INTERNAL);
    } catch (failErr) {
      this.logger.error(
        { jobId: job.data.jobId, err: (failErr as Error).message, cause: err.name },
        'Could not record a failed job; the sweeper will time it out',
      );
    }
  }

  /**
   * NFR-R10: stop taking jobs and let the current ones finish, up to WORKER_SHUTDOWN_TIMEOUT_MS.
   * A job cut off after that is recovered through stalled detection. Runs before Prisma and
   * Redis disconnect (`onApplicationShutdown`).
   */
  async beforeApplicationShutdown(): Promise<void> {
    if (!this.worker) return;
    const worker = this.worker;
    this.worker = undefined;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.config.timeouts.workerShutdownMs);
    });
    const closing = worker.close().catch(() => undefined);
    const result = await Promise.race([closing, timedOut]);
    clearTimeout(timer);
    if (result === 'timeout') {
      // Stop waiting rather than `close(true)`: BullMQ returns the pending close for a second
      // call, so a forced close would still wait for the job. The process exits after the
      // shutdown hooks; the job's lock expires and stalled detection hands it to another worker.
      this.logger.warn('Shutdown timeout: leaving active jobs to stalled recovery');
    }
  }
}
