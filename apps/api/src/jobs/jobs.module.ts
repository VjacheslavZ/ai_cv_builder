import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller.js';
import { JobsRepository } from './jobs.repository.js';

@Module({
  controllers: [JobsController],
  providers: [JobsRepository],
  exports: [JobsRepository],
})
export class JobsModule {}
