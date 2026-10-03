import { Global, Inject, Module } from '@nestjs/common';
import { RedisConnectionFactory } from './redis.connection-factory.js';

export const REDIS_GENERAL = Symbol('REDIS_GENERAL');
export const REDIS_SUBSCRIBER = Symbol('REDIS_SUBSCRIBER');

export const InjectRedis = () => Inject(REDIS_GENERAL);
export const InjectRedisSubscriber = () => Inject(REDIS_SUBSCRIBER);

/**
 * One shared `general` and one shared `subscriber` connection per process. BullMQ
 * connections are created per queue/worker via `RedisConnectionFactory.create('bullmq')`.
 */
@Global()
@Module({
  providers: [
    RedisConnectionFactory,
    {
      provide: REDIS_GENERAL,
      inject: [RedisConnectionFactory],
      useFactory: (factory: RedisConnectionFactory) => factory.create('general'),
    },
    {
      provide: REDIS_SUBSCRIBER,
      inject: [RedisConnectionFactory],
      useFactory: (factory: RedisConnectionFactory) => factory.create('subscriber'),
    },
  ],
  exports: [RedisConnectionFactory, REDIS_GENERAL, REDIS_SUBSCRIBER],
})
export class RedisModule {}
