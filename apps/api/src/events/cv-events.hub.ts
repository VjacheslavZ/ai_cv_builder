import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { PublishedCvEvent } from '@cv/shared';
import type { Redis } from 'ioredis';
import { InjectRedisSubscriber } from '../redis/redis.module.js';
import { cvEventsChannel } from './cv-events.publisher.js';

export type CvEventListener = (event: PublishedCvEvent) => void;

/**
 * One shared Redis subscriber per API process, fanned out in-process to every open SSE
 * stream. A channel is subscribed while at least one stream listens to it.
 */
@Injectable()
export class CvEventsHub implements OnModuleDestroy {
  private readonly logger = new Logger(CvEventsHub.name);
  private readonly listeners = new Map<string, Set<CvEventListener>>();
  /** The pending or confirmed SUBSCRIBE per channel, so every caller waits for it. */
  private readonly subscribed = new Map<string, Promise<unknown>>();

  constructor(@InjectRedisSubscriber() private readonly subscriber: Redis) {
    this.subscriber.on('message', (channel: string, message: string) => {
      this.dispatch(channel, message);
    });
  }

  /** Resolves once Redis confirmed the subscription; returns the unsubscribe function. */
  async subscribe(cvId: string, listener: CvEventListener): Promise<() => void> {
    const channel = cvEventsChannel(cvId);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
    let ready = this.subscribed.get(channel);
    if (!ready) {
      ready = this.subscriber.subscribe(channel);
      this.subscribed.set(channel, ready);
    }
    try {
      await ready;
    } catch (err) {
      this.subscribed.delete(channel);
      this.remove(channel, listener);
      throw err;
    }
    return () => this.remove(channel, listener);
  }

  private remove(channel: string, listener: CvEventListener): void {
    const set = this.listeners.get(channel);
    if (!set?.delete(listener) || set.size > 0) return;
    this.listeners.delete(channel);
    if (!this.subscribed.delete(channel)) return;
    this.subscriber.unsubscribe(channel).catch((err: Error) => {
      this.logger.debug({ err: err.message }, 'Unsubscribe failed');
    });
  }

  private dispatch(channel: string, message: string): void {
    const set = this.listeners.get(channel);
    if (!set) return;
    let event: PublishedCvEvent;
    try {
      event = JSON.parse(message) as PublishedCvEvent;
    } catch {
      this.logger.warn({ channel }, 'Dropped a malformed event');
      return;
    }
    for (const listener of set) listener(event);
  }

  onModuleDestroy(): void {
    this.listeners.clear();
    this.subscribed.clear();
  }
}
