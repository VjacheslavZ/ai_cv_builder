import { Controller, Get } from '@nestjs/common';
import type { AuthUser, JobStatusDto } from '@cv/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UuidParam } from '../common/http/uuid-param.js';
import { ownedOrNotFound } from '../common/ownership/owned.js';
import { toJobStatusDto } from './job.mapper.js';
import { JobsRepository } from './jobs.repository.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsRepository) {}

  /** The fallback when SSE is unavailable. */
  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<JobStatusDto> {
    return toJobStatusDto(ownedOrNotFound(await this.jobs.findOwned(id, user.id)));
  }
}
