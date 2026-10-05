import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@cv/shared';
import { InjectConfig } from '../config/config.module.js';
import type { GroundingResult } from '../grounding/ground-cv.js';
import type { AppConfig } from '../config/env.schema.js';
import { InjectLlmClient, type GenerateCvRequest, type LlmClient } from '../llm/llm-client.js';
import { countMeaningfulChars, PdfExtractor } from '../pdf/pdf-extractor.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CvBullJob } from '../queue/cv-queue.service.js';
import { withAccountContact } from './account-contact.js';
import { runGenerationLoop } from './generation-loop.js';
import { PermanentJobError } from './job-errors.js';
import { JobState, type ActiveJob } from './job-state.js';
import { callWithinDeadline, runJob } from './run-job.js';

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

  process(bullJob: CvBullJob): Promise<void> {
    return runJob(
      bullJob,
      {
        state: this.state,
        logger: this.logger,
        failOptions: (code) => ({ deleteUpload: code.startsWith('PDF_') }),
      },
      async (job) => {
        await this.extract(job);
        await this.state.complete(job, await this.generate(job));
      },
    );
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

    const { result } = await runGenerationLoop({
      targetRole: job.cv.targetRole,
      sources,
      invalidOutputRetries: this.config.llm.invalidOutputRetries,
      checkCapitalizedTokens: this.config.grounding.checkCapitalizedTokens,
      call: async (request) => {
        const output = await this.callLlm(job, request);
        if (job.stage !== 'validating') await this.state.enterStage(job, 'validating');
        return output;
      },
      onInvalidOutput: (invalidAnswers, issues) =>
        this.logger.warn({ jobId: job.id, invalidAnswers, issues }, 'Invalid LLM output'),
    });
    this.logger.log(
      {
        jobId: job.id,
        removed: result.removed.length,
        removedByReason: countBy(result.removed.map((r) => r.reason)),
        questions: result.questions.length,
      },
      'Grounding finished',
    );
    // The name and email from sign-up stand in for what the sources do not give.
    const account = await this.prisma.user.findUnique({
      where: { id: job.cv.userId },
      select: { firstName: true, lastName: true, email: true },
    });
    return account ? withAccountContact(result, account) : result;
  }

  private async callLlm(
    job: ActiveJob,
    request: Omit<GenerateCvRequest, 'signal'>,
  ): Promise<unknown> {
    const response = await callWithinDeadline(
      job,
      this.state,
      this.config.timeouts.llmMs,
      (signal) => this.llm.generateCv({ ...request, signal }),
    );
    return response.output;
  }
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return counts;
}
