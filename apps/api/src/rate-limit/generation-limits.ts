import { Injectable } from '@nestjs/common';
import { ACTIVE_JOB_STATUSES, ErrorCode } from '@cv/shared';
import type { Redis } from 'ioredis';
import { ApiException } from '../common/errors/api.exception.js';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InjectRedis } from '../redis/redis.module.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * NFR-S9: at most N active generation jobs per user (counted in Postgres, the source of truth)
 * and N generations per hour (a Redis counter); answers applied by the AI have their own hourly
 * counter and never count toward the generation limits.
 */
@Injectable()
export class GenerationLimits {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  /** Counts one generation for this hour; `429` past the limit, `503` if Redis fails (never unlimited). */
  consumeHourly(userId: string, now = Date.now()): Promise<void> {
    return this.consume(
      `rl:gen:${userId}`,
      this.config.limits.generationsPerHour,
      'You have started too many generations this hour. Try again later.',
      now,
    );
  }

  /**
   * Counts one AI-applied answer for this hour (NFR-S9): separate from generations, since
   * `apply_answer` jobs are serialized per CV rather than limited by active slots.
   */
  consumeAnswerHourly(userId: string, now = Date.now()): Promise<void> {
    return this.consume(
      `rl:ans:${userId}`,
      this.config.limits.answersPerHour,
      'You have sent too many answers this hour. Try again later.',
      now,
    );
  }

  private async consume(prefix: string, limit: number, message: string, now: number) {
    const key = `${prefix}:${Math.floor(now / HOUR_MS)}`;
    let count: number;
    try {
      const [[incrErr, incremented], [expireErr]] = (await this.redis
        .multi()
        .incr(key)
        .expire(key, HOUR_MS / 1000)
        .exec()) as [[Error | null, number], [Error | null, unknown]];
      if (incrErr ?? expireErr) throw incrErr ?? expireErr;
      count = incremented;
    } catch {
      throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE, 'Service unavailable');
    }
    if (count > limit) throw new ApiException(ErrorCode.RATE_LIMITED, message);
  }

  /**
   * Inside the transaction that creates the job: a per-user advisory lock serializes concurrent
   * creates, so two requests cannot both see "one slot left".
   */
  async assertActiveSlot(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
    const active = await tx.job.count({
      where: { userId, type: 'generate', status: { in: [...ACTIVE_JOB_STATUSES] } },
    });
    if (active >= this.config.limits.maxActiveGenerationsPerUser) {
      throw new ApiException(
        ErrorCode.RATE_LIMITED,
        'Wait for your current generations to finish before starting another.',
      );
    }
  }
}
