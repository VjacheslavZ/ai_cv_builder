import { Global, Module } from '@nestjs/common';
import { CvQueueService } from './cv-queue.service.js';

@Global()
@Module({
  providers: [CvQueueService],
  exports: [CvQueueService],
})
export class QueueModule {}
