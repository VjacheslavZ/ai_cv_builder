import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIVE_JOB_STATUSES,
  cvDocumentSchema,
  ErrorCode,
  OPEN_QUESTIONS_MAX,
  type CvDocument,
} from '@cv/shared';
import { CvEventsPublisher } from '../../events/cv-events.publisher.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { DraftQuestion } from '../../grounding/questions.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JobStopped, PermanentJobError } from '../job-errors.js';
import type { ActiveJob } from '../job-state.js';
import { mergeSection } from './merge-section.js';
import { currentSection } from './section.js';

/**
 * Another AI write committed since this job read the CV (e.g. after its lock expired). The
 * result is discarded and BullMQ retries the job on the new state (NFR-R6, AC-9.7).
 */
export class AiRevisionChanged extends Error {
  constructor() {
    super('The CV changed under an AI write; retrying on the new state');
    this.name = 'AiRevisionChanged';
  }
}

export interface ApplyResult {
  scope: string;
  /** `aiRevision` when the job read the CV. */
  startRevision: number;
  /** The grounded rewrite (only `scope` is read from it). */
  rewritten: CvDocument;
  returnedIds: ReadonlySet<string>;
  /** New questions from grounding and the model, already narrowed to `scope`. */
  questions: DraftQuestion[];
}

/** The commit of an `apply_answer` job, under the CV row lock (FR-9). */
@Injectable()
export class ApplyState {
  private readonly logger = new Logger(ApplyState.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: CvEventsPublisher,
  ) {}

  /**
   * Fenced by `aiRevision`, which only AI writes bump: a manual PATCH never makes this retry.
   * The section is merged onto the **current** document and every manual edit is restored
   * (AC-9.3); the previous section goes to `AiSnapshot`; the question becomes `answered`.
   */
  async commit(job: ActiveJob, result: ApplyResult): Promise<void> {
    const { scope } = result;
    const version = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cvs WHERE id = ${job.cvId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new JobStopped();
      const cv = await tx.cv.findUniqueOrThrow({ where: { id: job.cvId } });
      if (cv.aiRevision !== result.startRevision) throw new AiRevisionChanged();
      const current = cv.document as unknown as CvDocument;

      const merged = cvDocumentSchema.safeParse(
        mergeSection({
          current,
          scope,
          rewritten: result.rewritten,
          returnedIds: result.returnedIds,
        }),
      );
      if (!merged.success) throw new PermanentJobError(ErrorCode.LLM_INVALID_OUTPUT);

      const { count } = await tx.job.updateMany({
        where: { id: job.id, status: { in: [...ACTIVE_JOB_STATUSES] } },
        data: { status: 'completed', stage: 'completed', errorCode: null, errorMessage: null },
      });
      if (count === 0) throw new JobStopped();

      await this.addQuestions(tx, job.cvId, result.questions);
      if (job.questionId) {
        await tx.question.updateMany({
          where: { id: job.questionId, status: 'applying' },
          data: { status: 'answered' },
        });
      }
      const snapshot = {
        path: scope,
        section: (currentSection(current, scope) ?? null) as Prisma.InputJsonValue,
        aiRevision: cv.aiRevision,
      };
      await tx.aiSnapshot.upsert({
        where: { cvId: job.cvId },
        create: { cvId: job.cvId, ...snapshot },
        update: { ...snapshot, createdAt: new Date() },
      });
      const updated = await tx.cv.update({
        where: { id: job.cvId },
        data: {
          document: merged.data as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          aiRevision: { increment: 1 },
        },
        select: { version: true },
      });
      return updated.version;
    });

    this.logger.log({ jobId: job.id, cvId: job.cvId, scope, version }, 'Answer applied');
    await this.events.publish(job.cvId, {
      type: 'section_updated',
      path: scope,
      version,
      questionId: job.questionId ?? '',
    });
  }

  /**
   * New questions for the rewritten part (AC-7.5, AC-8.6): one per place (an open question
   * already there wins), most important first, and never more than 10 open in total.
   */
  private async addQuestions(
    tx: Prisma.TransactionClient,
    cvId: string,
    questions: DraftQuestion[],
  ): Promise<void> {
    const existing = await tx.question.findMany({
      where: { cvId, status: { in: ['open', 'applying'] } },
      select: { path: true, status: true },
    });
    const taken = new Set(existing.map((q) => q.path));
    const room = OPEN_QUESTIONS_MAX - existing.filter((q) => q.status === 'open').length;
    const fresh = questions
      .filter((q) => !taken.has(q.path))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, Math.max(0, room));
    if (fresh.length > 0) {
      await tx.question.createMany({ data: fresh.map((q) => ({ cvId, ...q })) });
    }
  }
}
