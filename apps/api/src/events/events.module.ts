import { Global, Module } from '@nestjs/common';
import { CvEventsPublisher } from './cv-events.publisher.js';

/** The publisher, used by the worker (and later by API writes). The hub lives in CvsModule. */
@Global()
@Module({
  providers: [CvEventsPublisher],
  exports: [CvEventsPublisher],
})
export class EventsModule {}
