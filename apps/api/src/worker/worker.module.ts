import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { LoggerModule } from '../logging/logger.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';

/** The worker's DI context: no HTTP. BullMQ processors arrive in Phase 2. */
@Module({
  imports: [ConfigModule, LoggerModule, PrismaModule, RedisModule],
})
export class WorkerModule {}
