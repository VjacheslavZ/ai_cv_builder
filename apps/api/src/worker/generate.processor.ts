import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode, llmCvOutputSchema } from '@cv/shared';
import { UnrecoverableError } from 'bullmq';
import { InjectConfig } from '../config/config.module.js';
import { groundCv, type GroundingResult } from '../grounding/ground-cv.js';
import type { AppConfig } from '../config/env.schema.js';
import {
  InjectLlmClient,
  LlmError,
  type GenerateCvRequest,
  type LlmClient,
} from '../llm/llm-client.js';
import { countMeaningfulChars, PdfExtractor } from '../pdf/pdf-extractor.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CvBullJob } from '../queue/cv-queue.service.js';
import { JobStopped, PermanentJobError } from './job-errors.js';
import { JobState, type ActiveJob } from './job-state.js';

/**
 * The `generate` pipeline: `extracting → generating → validating → completed`. Every LLM
 * answer passes the Zod schema and the grounding check before anything touches the CV.
 *
 * At-least-once: the same job may run twice (stalled recovery, sweeper re-enqueue). Every
 * stage starts with a guarded transition and the result is written whole under the CV row
 * lock, so a duplicate run either stops quietly or produces the same single result.
 */
@Injectable()
export class GenerateProcessor {
  private readonly logger = new Logger(GenerateProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: JobState,
    private readonly pdf: PdfExtractor,
    @InjectLlmClient() private readonly llm: LlmClient,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async process(bullJob: CvBullJob): Promise<void> {
    const jobId = bullJob.data.jobId;
    const attempt = bullJob.attemptsMade + 1;
    const startedAt = Date.now();

    const job = await this.state.start(jobId, attempt);
    if (!job) {
      this.logger.log({ jobId }, 'Job is no longer active; skipped');
      return;
    }

    try {
      if (job.deadlineAt.getTime() <= Date.now())
        throw new PermanentJobError(ErrorCode.JOB_TIMEOUT);
      await this.extract(job);
      const result = await this.generate(job);
      await this.state.complete(job, result);
      this.logger.log(
        { jobId, cvId: job.cvId, attempt, durationMs: Date.now() - startedAt },
        'Job completed',
      );
    } catch (err) {
      if (err instanceof JobStopped) {
        this.logger.log({ jobId, stage: job.stage }, 'Job stopped: no longer active or CV deleted');
        return;
      }
      if (err instanceof PermanentJobError) {
        await this.state.fail(jobId, err.code, { deleteUpload: err.code.startsWith('PDF_') });
        throw new UnrecoverableError(err.code);
      }
      const code = err instanceof LlmError ? ErrorCode.LLM_UNAVAILABLE : ErrorCode.INTERNAL;
      const attempts = bullJob.opts.attempts ?? 1;
      this.logger.warn(
        { jobId, stage: job.stage, attempt, attempts, err: (err as Error).name },
        'Job attempt failed',
      );
      // The last attempt: BullMQ will not retry, so the DB job fails now.
      if (attempt >= attempts) await this.state.fail(jobId, code);
      throw err;
    }
  }

  /** `extracting`: PDF → text in a worker thread; the upload is deleted in every terminal case. */
  private async extract(job: ActiveJob): Promise<void> {
    await this.state.enterStage(job, 'extracting');
    const upload = await this.prisma.pdfUpload.findUnique({ where: { cvId: job.cvId } });
    if (!upload) return; // no PDF, or a previous run already extracted it

    const result = await this.pdf.extract(upload.bytes);
    if (!result.ok) throw new PermanentJobError(ErrorCode[result.code]);

    const meaningful = countMeaningfulChars(result.text);
    this.logger.log({ jobId: job.id, pages: result.pages, chars: meaningful }, 'PDF extracted');
    if (meaningful >= this.config.pdf.minTextChars) {
      await this.state.savePdfText(job, result.text);
      return;
    }
    // A scan (AC-4.3): continue with the free text and warn, or fail.
    const hasFreeText = await this.prisma.sourceText.count({
      where: { cvId: job.cvId, kind: 'free_text' },
    });
    if (!hasFreeText) throw new PermanentJobError(ErrorCode.PDF_NO_TEXT);
    await this.state.skipPdfWithWarning(job);
  }

  /** `generating` + `validating`: an invalid answer is re-requested with the errors (AC-6.6). */
  private async generate(job: ActiveJob): Promise<GroundingResult> {
    await this.state.enterStage(job, 'generating');
    const sources = await this.prisma.sourceText.findMany({
      where: { cvId: job.cvId },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, text: true },
    });
    // The upload expired before extraction and there is no free text to fall back on.
    if (sources.length === 0) throw new PermanentJobError(ErrorCode.PDF_EXPIRED);

    let feedback: string | undefined;
    let invalidAnswers = 0;
    let roleRetried = false;
    for (;;) {
      const output = await this.callLlm(job, { targetRole: job.cv.targetRole, sources, feedback });
      if (job.stage !== 'validating') await this.state.enterStage(job, 'validating');

      // 1. The schema (AC-6.6): an invalid answer is re-requested with the errors, ≤ N times.
      const parsed = llmCvOutputSchema.safeParse(output);
      if (!parsed.success) {
        invalidAnswers++;
        this.logger.warn(
          { jobId: job.id, invalidAnswers, issues: parsed.error.issues.length },
          'Invalid LLM output',
        );
        if (invalidAnswers > this.config.llm.invalidOutputRetries) {
          throw new PermanentJobError(ErrorCode.LLM_INVALID_OUTPUT);
        }
        feedback = parsed.error.issues
          .slice(0, 20)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('\n');
        continue;
      }

      // 2. Grounding (FR-7): unsupported facts are removed and turned into questions.
      const result = groundCv({
        output: parsed.data,
        sources: sources.map((s) => s.text),
        targetRole: job.cv.targetRole,
        checkCapitalizedTokens: this.config.grounding.checkCapitalizedTokens,
        dropSummaryOnRoleClaim: roleRetried,
      });
      // AC-7.7: a summary claiming the target role gets one re-request, then it is dropped.
      if (result.summaryRoleClaim && !roleRetried) {
        roleRetried = true;
        feedback =
          'The summary claims the target role, which the sources do not support. Rewrite the summary without stating or implying that the person holds the target role.';
        continue;
      }
      this.logger.log(
        {
          jobId: job.id,
          removed: result.removed.length,
          removedByReason: countBy(result.removed.map((r) => r.reason)),
          questions: result.questions.length,
        },
        'Grounding finished',
      );
      return result;
    }
  }

  /** One LLM call within the job's time budget; permanent LLM errors fail the job (AC-5.6). */
  private async callLlm(
    job: ActiveJob,
    request: Omit<GenerateCvRequest, 'signal'>,
  ): Promise<unknown> {
    // NFR-R3: retry layers multiply, so every call must fit before the job's deadline.
    const callMs = this.config.timeouts.llmMs;
    if (job.deadlineAt.getTime() - Date.now() < callMs) {
      throw new PermanentJobError(ErrorCode.JOB_TIMEOUT);
    }
    const signal = AbortSignal.timeout(callMs);
    try {
      const response = await this.llm.generateCv({ ...request, signal });
      return response.output;
    } catch (err) {
      if (err instanceof LlmError && !err.retryable) {
        throw new PermanentJobError(ErrorCode.LLM_UNAVAILABLE);
      }
      throw err;
    } finally {
      // The LLM call took a while: stop here if the CV was deleted meanwhile (AC-5.9).
      await this.state.assertActive(job.id);
    }
  }
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return counts;
}
