import { Controller, Get } from '@nestjs/common';
import type { AuthUser } from '@cv/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CvsRepository, type CvSummary } from './cvs.repository.js';

@Controller('cvs')
export class CvsController {
  constructor(private readonly cvs: CvsRepository) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<CvSummary[]> {
    return this.cvs.listOwned(user.id);
  }
}
