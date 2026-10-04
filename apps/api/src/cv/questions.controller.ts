import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { answerSchema, type AnswerInput, type AnswerResponse, type AuthUser } from '@cv/shared';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UuidParam } from '../common/http/uuid-param.js';
import { QuestionsService } from './questions.service.js';

@Controller('cvs/:id/questions/:qid')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  /** AC-8.4: skip → `dismissed`. */
  @Post('dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  dismiss(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('qid') qid: string,
  ): Promise<void> {
    return this.questions.dismiss(id, qid, user.id);
  }

  /**
   * `200 { status: 'answered', version }` for a simple field (AC-9.2), `202 { status:
   * 'applying', jobId }` when the AI rewrites the section (AC-9.1).
   */
  @Post('answer')
  async answer(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('qid') qid: string,
    @Body({ schema: answerSchema }) body: AnswerInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AnswerResponse> {
    const result = await this.questions.answer(id, qid, user.id, body.answer);
    res.status(result.status === 'applying' ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return result;
  }
}
