import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { InjectRedis } from '../../redis/redis.module.js';

/** Deletes the lock only if `token` still owns it. */
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

/** Per BullMQ prefix, so parallel test files never share a lock. */
export const cvLockKey = (prefix: string, cvId: string) => `${prefix}:lock:cv:${cvId}`;

/**
 * The per-CV lock that serializes `apply_answer` jobs (AC-9.7): `SET NX PX` with an owner token,
 * released by compare-and-delete. It is an optimization, not the safety net: if it expires
 * mid-job, the commit's `aiRevision` fencing discards a stale result.
 */
@Injectable()
export class CvLock {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async acquire(cvId: string, token: string): Promise<boolean> {
    const key = cvLockKey(this.config.queue.prefix, cvId);
    const result = await this.redis.set(key, token, 'PX', this.config.timeouts.cvLockTtlMs, 'NX');
    return result === 'OK';
  }

  async release(cvId: string, token: string): Promise<void> {
    const key = cvLockKey(this.config.queue.prefix, cvId);
    await this.redis.eval(RELEASE, 1, key, token).catch(() => undefined);
  }
}
