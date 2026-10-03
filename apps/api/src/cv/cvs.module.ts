import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { CvEventsHub } from '../events/cv-events.hub.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { GenerationLimits } from '../rate-limit/generation-limits.js';
import { CvEventsController } from './cv-events.controller.js';
import { CvsController } from './cvs.controller.js';
import { CvsRepository } from './cvs.repository.js';
import { CvsService } from './cvs.service.js';

@Module({
  imports: [
    JobsModule,
    // No `dest`/`storage`: multer keeps the upload in memory (NFR-S5). One file at most.
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        limits: { fileSize: config.pdf.maxBytes, files: 1, fields: 10 },
      }),
    }),
  ],
  controllers: [CvsController, CvEventsController],
  providers: [CvsRepository, CvsService, CvEventsHub, GenerationLimits],
})
export class CvsModule {}
