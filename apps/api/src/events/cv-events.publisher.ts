import { Injectable, Logger } from '@nestjs/common';
import type { PublishedCvEvent } from '@cv/shared';
import type { Redis } from 'ioredis';
import { InjectRedis } from '../redis/redis.module.js';

/** Pub/Sub channel for one CV's live events (SPEC §6.1). */
export const cvEventsChannel = (cvId: string) => `cv:${cvId}:events`;

/**
 * Publishes after the DB commit. Losing an event is harmless: every SSE (re)connect starts
 * with a snapshot from Postgres (AC-5.1), so a failed publish is logged and swallowed.
 */
@Injectable()
export class CvEventsPublisher {
  private readonly logger = new Logger(CvEventsPublisher.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async publish(cvId: string, event: PublishedCvEvent): Promise<void> {
    try {
      await this.redis.publish(cvEventsChannel(cvId), JSON.stringify(event));
    } catch (err) {
      this.logger.warn({ cvId, type: event.type, err: (err as Error).message }, 'Publish failed');
    }
  }
}
