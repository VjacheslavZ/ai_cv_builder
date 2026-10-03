import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { CvsModule } from './cv/cvs.module.js';
import { HealthModule } from './health/health.module.js';
import { LoggerModule } from './logging/logger.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    AuthModule,
    HealthModule,
    CvsModule,
  ],
})
export class AppModule {}
