import { Controller, Get, Logger, Req, Res } from '@nestjs/common';
import { ErrorCode, type AuthUser, type CvEvent, type PublishedCvEvent } from '@cv/shared';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { UuidParam } from '../common/http/uuid-param.js';
import { ownedOrNotFound } from '../common/ownership/owned.js';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { CvEventsHub } from '../events/cv-events.hub.js';
import { CvsRepository } from './cvs.repository.js';
import { CvsService } from './cvs.service.js';

@Controller('cvs')
export class CvEventsController {
  private readonly logger = new Logger(CvEventsController.name);

  constructor(
    private readonly cvs: CvsRepository,
    private readonly service: CvsService,
    private readonly hub: CvEventsHub,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  /**
   * SSE (AC-5.1): subscribe first, then send a snapshot from Postgres, then the live events
   * (those that arrived while the snapshot was read are sent right after it; the client
   * applies events monotonically). A heartbeat keeps the Next.js rewrite from closing an idle
   * stream (it gives up after 30 s of silence).
   */
  @Get(':id/events')
  async events(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    ownedOrNotFound(await this.cvs.findOwned(id, user.id));

    let open = true;
    let live = false;
    const pending: PublishedCvEvent[] = [];
    const send = (event: CvEvent) => {
      if (open) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    let unsubscribe: () => void;
    try {
      unsubscribe = await this.hub.subscribe(id, (event) => {
        if (live) send(event);
        else pending.push(event);
      });
    } catch {
      // Redis is down: the client falls back to `GET /api/jobs/:id` (AC-5.4).
      throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE, 'Service unavailable');
    }

    let heartbeat: NodeJS.Timeout | undefined = undefined;
    const close = () => {
      if (!open) return;
      open = false;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };
    // `res` closes when the client goes away (or after `end`).
    res.on('close', close);
    if (req.destroyed) return close();

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`retry: ${this.config.timeouts.sseRetryMs}\n\n`);

    try {
      const snapshot = await this.service.progress(id, user.id);
      if (!snapshot) return close();
      send({ type: 'snapshot', ...snapshot });
    } catch (err) {
      this.logger.warn({ cvId: id, err: (err as Error).message }, 'SSE snapshot failed');
      return close();
    }
    live = true;
    for (const event of pending.splice(0)) send(event);
    heartbeat = setInterval(() => send({ type: 'heartbeat' }), this.config.timeouts.sseHeartbeatMs);
  }
}
