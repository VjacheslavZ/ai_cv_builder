import { Injectable, Logger } from '@nestjs/common';
import {
  applyScopeFor,
  ErrorCode,
  isSimpleField,
  parseSimpleAnswer,
  setField,
  type AnswerResponse,
} from '@cv/shared';
import { ApiException } from '../common/errors/api.exception.js';
import { ownedOrNotFound } from '../common/ownership/owned.js';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { CvModel } from '../generated/prisma/models/Cv.js';
import type { QuestionModel } from '../generated/prisma/models/Question.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CvQueueService } from '../queue/cv-queue.service.js';
import { GenerationLimits } from '../rate-limit/generation-limits.js';
import { addEditedPaths } from './apply-ops.js';
import { editableDocument, resolveCoveredQuestions } from './cv-editing.service.js';
import { CvsRepository } from './cvs.repository.js';

/** A question can be answered or skipped while `open`, and answered again after `failed`. */
const ACTIONABLE = new Set(['open', 'failed']);

const answerError = (message: string) =>
  new ApiException(ErrorCode.VALIDATION_ERROR, 'Invalid request', { fields: { answer: message } });

/** Skipping and answering questions (FR-8, FR-9). Every write holds the CV row lock. */
@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cvs: CvsRepository,
    private readonly queue: CvQueueService,
    private readonly limits: GenerationLimits,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  /** AC-8.4: the question leaves the open list; the CV is unchanged. */
  async dismiss(cvId: string, questionId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { question } = await this.lockQuestion(tx, cvId, questionId, userId);
      await tx.question.update({ where: { id: question.id }, data: { status: 'dismissed' } });
    });
  }

  /**
   * The answer is always saved as a source fact. A simple field is written at once (AC-9.2);
   * anything else starts an `apply_answer` job that rewrites the section (AC-9.1).
   */
  async answer(
    cvId: string,
    questionId: string,
    userId: string,
    answer: string,
  ): Promise<AnswerResponse> {
    const result = await this.prisma.$transaction(async (tx): Promise<AnswerResponse> => {
      const { cv, question } = await this.lockQuestion(tx, cvId, questionId, userId);
      const document = editableDocument(cv);
      await tx.sourceText.create({ data: { cvId, kind: 'answer', text: answer } });

      if (isSimpleField(question.path)) {
        const parsed = parseSimpleAnswer(question.path, answer);
        if (!parsed.ok) throw answerError(parsed.message);
        const next = structuredClone(document);
        if (!setField(next, question.path, parsed.value)) {
          throw answerError('This place is no longer in the CV');
        }
        next.editedPaths = addEditedPaths(next.editedPaths, [question.path]);
        const updated = await tx.cv.update({
          where: { id: cvId },
          data: { document: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
          select: { version: true },
        });
        await tx.question.update({
          where: { id: question.id },
          data: { status: 'answered', answer },
        });
        await resolveCoveredQuestions(tx, cvId, [question.path]);
        return { status: 'answered', version: updated.version };
      }

      if (!applyScopeFor(question.path)) throw answerError('This question cannot be answered');
      await this.limits.consumeAnswerHourly(userId);
      const job = await tx.job.create({
        data: {
          cvId,
          userId,
          type: 'apply_answer',
          questionId: question.id,
          deadlineAt: new Date(Date.now() + this.config.timeouts.jobDeadlineMs),
        },
        select: { id: true },
      });
      await tx.question.update({
        where: { id: question.id },
        data: { status: 'applying', answer },
      });
      return { status: 'applying', jobId: job.id };
    });

    if (result.status === 'applying') {
      await this.queue.addAfterCommit('apply_answer', result.jobId);
    }
    this.logger.log({ cvId, questionId, status: result.status }, 'Question answered');
    return result;
  }

  /** The CV row lock first, then the question; `404` unless both are the user's. */
  private async lockQuestion(
    tx: Prisma.TransactionClient,
    cvId: string,
    questionId: string,
    userId: string,
  ): Promise<{ cv: CvModel; question: QuestionModel }> {
    const cv = ownedOrNotFound(await this.cvs.lockOwned(tx, cvId, userId));
    const question = ownedOrNotFound(
      await tx.question.findFirst({ where: { id: questionId, cvId } }),
    );
    if (!ACTIONABLE.has(question.status)) {
      throw new ApiException(ErrorCode.QUESTION_NOT_OPEN, 'This question is no longer open');
    }
    return { cv, question };
  }
}
