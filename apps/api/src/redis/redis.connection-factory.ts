import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';

/**
 * - `general`: commands (sessions, rate-limit counters, locks). Fails a command after one
 *   reconnect attempt or `REDIS_COMMAND_TIMEOUT_MS`, so callers can fail closed with 503
 *   instead of hanging (NFR-R12).
 * - `bullmq`: queues and workers. BullMQ requires `maxRetriesPerRequest: null`.
 * - `subscriber`: Pub/Sub only; a subscribed connection cannot run other commands.
 */
export type RedisConnectionKind = 'general' | 'bullmq' | 'subscriber';

const OPTIONS: Record<RedisConnectionKind, RedisOptions> = {
  general: { maxRetriesPerRequest: 1 },
  bullmq: { maxRetriesPerRequest: null },
  subscriber: { maxRetriesPerRequest: null, lazyConnect: true },
};

@Injectable()
export class RedisConnectionFactory implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisConnectionFactory.name);
  private readonly connections = new Set<Redis>();

  constructor(@InjectConfig() private readonly config: AppConfig) {}

  create(kind: RedisConnectionKind, name: string = kind): Redis {
    const connection = new Redis(this.config.redisUrl, {
      ...OPTIONS[kind],
      ...(kind === 'general' ? { commandTimeout: this.config.timeouts.redisCommandMs } : {}),
      connectionName: `cv:${name}`,
    });
    // Without a listener ioredis reports every failed reconnect as an unhandled error.
    connection.on('error', (err: Error) => {
      this.logger.warn({ connection: name, err: err.message }, 'Redis connection error');
    });
    this.connections.add(connection);
    return connection;
  }

  /**
   * QUIT politely, but never wait on Redis longer than REDIS_COMMAND_TIMEOUT_MS: a `bullmq` or
   * `subscriber` connection has no command timeout, and on a socket that stays open while Redis
   * is gone (e.g. a stopped container behind docker-proxy) QUIT would never resolve.
   */
  async onApplicationShutdown(): Promise<void> {
    const ms = this.config.timeouts.redisCommandMs;
    await Promise.all(
      [...this.connections].map(async (connection) => {
        let timer: NodeJS.Timeout | undefined;
        const timedOut = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, ms);
        });
        await Promise.race([connection.quit().catch(() => undefined), timedOut]);
        clearTimeout(timer);
        connection.disconnect();
      }),
    );
    this.connections.clear();
  }
}
