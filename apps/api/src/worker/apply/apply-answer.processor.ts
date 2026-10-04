import { Injectable, Logger } from '@nestjs/common';
import { ACTIVE_JOB_STATUSES, applyScopeFor, ErrorCode, type CvDocument } from '@cv/shared';
import { DelayedError } from 'bullmq';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { InjectLlmClient, type LlmClient } from '../../llm/llm-client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CvBullJob } from '../../queue/cv-queue.service.js';
import { runGenerationLoop } from '../generation-loop.js';
import { PermanentJobError } from '../job-errors.js';
import { JobState, type ActiveJob } from '../job-state.js';
import { callWithinDeadline, runJob } from '../run-job.js';
import { ApplyState } from './apply-state.js';
import { CvLock } from './cv-lock.js';
import {
  currentSection,
  editedFieldsText,
  inScope,
  returnedIds,
  scopeOutput,
  sectionIds,
} from './section.js';

/**
 * The `apply_answer` pipeline (FR-9): the AI rewrites only the part the question is about, with
 * the answer and every manual edit as sources, through the same Zod + grounding loop as a draft.
 *
 * Jobs on one CV run one at a time under a Redis lock; a job that finds it taken goes back to
 * delayed (AC-9.7). The commit is fenced by `aiRevision` and restores every manual edit, so an
 * expired lock or a concurrent PATCH can never lose anything (NFR-R6).
 */
@Injectable()
export class ApplyAnswerProcessor {
  private readonly logger = new Logger(ApplyAnswerProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: JobState,
    private readonly apply: ApplyState,
    private readonly lock: CvLock,
    @InjectLlmClient() private readonly llm: LlmClient,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async process(bullJob: CvBullJob, token: string): Promise<void> {
    const row = await this.prisma.job.findUnique({
      where: { id: bullJob.data.jobId },
      select: { cvId: true, status: true },
    });
    if (!row || !(ACTIVE_JOB_STATUSES as readonly string[]).includes(row.status)) {
      this.logger.log({ jobId: bullJob.data.jobId }, 'Job is no longer active; skipped');
      return;
    }
    if (!(await this.lock.acquire(row.cvId, token))) {
      // Another answer on this CV is being applied: try again shortly, without using an attempt.
      await bullJob.moveToDelayed(Date.now() + this.config.timeouts.cvLockRetryMs, token);
      throw new DelayedError();
    }
    try {
      await runJob(bullJob, { state: this.state, logger: this.logger }, (job) => this.run(job));
    } finally {
      await this.lock.release(row.cvId, token);
    }
  }

  private async run(job: ActiveJob): Promise<void> {
    const question = job.questionId
      ? await this.prisma.question.findUnique({ where: { id: job.questionId } })
      : null;
    const scope = question && applyScopeFor(question.path);
    if (!question || !scope) throw new PermanentJobError(ErrorCode.INTERNAL);
    await this.state.enterStage(job, 'applying');

    // Read under the lock, so a job queued behind another starts from its result.
    const cv = await this.prisma.cv.findUniqueOrThrow({ where: { id: job.cvId } });
    const document = cv.document as unknown as CvDocument | null;
    const section = document && currentSection(document, scope);
    if (!document || section === undefined) throw new PermanentJobError(ErrorCode.INTERNAL);

    const sources = await this.prisma.sourceText.findMany({
      where: { cvId: job.cvId },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, text: true },
    });
    const manual = editedFieldsText(document);
    if (manual) sources.push({ kind: 'manual', text: manual });
    const knownIds = sectionIds(section);

    const loop = await runGenerationLoop({
      targetRole: cv.targetRole,
      sources,
      invalidOutputRetries: this.config.llm.invalidOutputRetries,
      checkCapitalizedTokens: this.config.grounding.checkCapitalizedTokens,
      knownIds,
      prepare: (output) => scopeOutput(output, scope),
      call: async (request) => {
        const response = await callWithinDeadline(
          job,
          this.state,
          this.config.timeouts.llmMs,
          (signal) =>
            this.llm.rewriteSection({
              ...request,
              scope,
              section,
              question: question.text,
              answer: question.answer ?? '',
              signal,
            }),
        );
        return response.output;
      },
      onInvalidOutput: (invalidAnswers, issues) =>
        this.logger.warn({ jobId: job.id, invalidAnswers, issues }, 'Invalid LLM output'),
    });

    this.logger.log(
      { jobId: job.id, scope, removed: loop.result.removed.length, calls: loop.calls },
      'Rewrite grounded',
    );
    await this.apply.commit(job, {
      scope,
      startRevision: cv.aiRevision,
      rewritten: loop.result.document,
      returnedIds: returnedIds(loop.output, knownIds),
      questions: inScope(loop.result.questions, scope),
    });
  }
}
