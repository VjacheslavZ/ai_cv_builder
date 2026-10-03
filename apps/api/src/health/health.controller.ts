import { Controller, Get, Logger } from '@nestjs/common';
import { ErrorCode } from '@cv/shared';
import type { Redis } from 'ioredis';
import { ApiException } from '../common/errors/api.exception.js';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InjectRedis } from '../redis/redis.module.js';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Served outside the `/api` prefix: `/health` (liveness) and `/ready` (Postgres and Redis). */
@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const ms = this.config.timeouts.readyCheckMs;
    const [postgres, redis] = await Promise.allSettled([
      withTimeout(this.prisma.$queryRaw`SELECT 1`, ms),
      withTimeout(this.redis.ping(), ms),
    ]);

    const down = Object.entries({ postgres, redis }).flatMap(([name, result]) =>
      result.status === 'rejected' ? [{ name, reason: String(result.reason) }] : [],
    );
    if (down.length > 0) {
      this.logger.warn({ down }, 'Not ready');
      throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE, 'Service unavailable');
    }
    return { status: 'ok' };
  }
}
