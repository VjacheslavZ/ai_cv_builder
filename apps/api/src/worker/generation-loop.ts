import { ErrorCode, llmCvOutputSchema, type LlmCvOutput } from '@cv/shared';
import { groundCv, type GroundingResult } from '../grounding/ground-cv.js';
import type { GenerateCvRequest } from '../llm/llm-client.js';
import { PermanentJobError } from './job-errors.js';

export interface GenerationLoopInput {
  targetRole: string;
  sources: GenerateCvRequest['sources'];
  /** How many invalid answers are re-requested before the job fails (AC-6.6). */
  invalidOutputRetries: number;
  checkCapitalizedTokens: boolean;
  /** Ids of existing items the model was shown (a section rewrite keeps them, AC-9.3). */
  knownIds?: ReadonlySet<string>;
  /** Narrows a schema-valid answer before grounding, e.g. to the rewritten section only. */
  prepare?(output: LlmCvOutput): LlmCvOutput;
  /** One LLM call; returns the untrusted answer. */
  call(request: Omit<GenerateCvRequest, 'signal'>): Promise<unknown>;
  /** An answer failed the schema; `issues` is a count, never the content. */
  onInvalidOutput?(invalidAnswers: number, issues: number): void;
}

export interface GenerationLoopResult {
  result: GroundingResult;
  /** The schema-valid answer that was grounded. Never log it. */
  output: LlmCvOutput;
  calls: number;
  invalidAnswers: number;
  roleRetried: boolean;
}

/**
 * Generation with its re-requests, shared by the worker and the LLM evaluation: every answer
 * passes the Zod schema and then the grounding check. An invalid answer is re-requested with the
 * errors (AC-6.6); a summary claiming the target role gets one re-request, then it is dropped
 * (AC-7.7). Too many invalid answers fail with `LLM_INVALID_OUTPUT`.
 */
export async function runGenerationLoop(input: GenerationLoopInput): Promise<GenerationLoopResult> {
  const { targetRole, sources } = input;
  let feedback: string | undefined;
  let calls = 0;
  let invalidAnswers = 0;
  let roleRetried = false;
  for (;;) {
    calls++;
    const answer = await input.call({ targetRole, sources, feedback });

    // 1. The schema (AC-6.6): an invalid answer is re-requested with the errors, ≤ N times.
    const parsed = llmCvOutputSchema.safeParse(answer);
    if (!parsed.success) {
      invalidAnswers++;
      input.onInvalidOutput?.(invalidAnswers, parsed.error.issues.length);
      if (invalidAnswers > input.invalidOutputRetries) {
        throw new PermanentJobError(ErrorCode.LLM_INVALID_OUTPUT);
      }
      feedback = parsed.error.issues
        .slice(0, 20)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      continue;
    }

    // 2. Grounding (FR-7): unsupported facts are removed and turned into questions.
    const output = input.prepare ? input.prepare(parsed.data) : parsed.data;
    const result = groundCv({
      output,
      sources: sources.map((s) => s.text),
      targetRole,
      checkCapitalizedTokens: input.checkCapitalizedTokens,
      dropSummaryOnRoleClaim: roleRetried,
      knownIds: input.knownIds,
    });
    // AC-7.7: a summary claiming the target role gets one re-request, then it is dropped.
    if (result.summaryRoleClaim && !roleRetried) {
      roleRetried = true;
      feedback =
        'The summary claims the target role, which the sources do not support. Rewrite the summary without stating or implying that the person holds the target role.';
      continue;
    }
    return { result, output, calls, invalidAnswers, roleRetried };
  }
}
