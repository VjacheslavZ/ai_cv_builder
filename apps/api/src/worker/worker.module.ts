import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { EventsModule } from '../events/events.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { LoggerModule } from '../logging/logger.module.js';
import { PdfExtractor } from '../pdf/pdf-extractor.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { CvWorker } from './cv-worker.js';
import { GenerateProcessor } from './generate.processor.js';
import { JobState } from './job-state.js';
import { Sweeper } from './sweeper.js';

/** The worker's DI context: no HTTP. Runs the BullMQ worker and the sweeper. */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    EventsModule,
    LlmModule,
  ],
  providers: [JobState, PdfExtractor, GenerateProcessor, CvWorker, Sweeper],
})
export class WorkerModule {}
