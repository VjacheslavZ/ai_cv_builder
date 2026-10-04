import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Logger } from '@nestjs/common';
import { llmCvOutputSchema } from '@cv/shared';
import { classifyLlmError } from './classify-error.js';
import {
  LlmError,
  type GenerateCvRequest,
  type LlmClient,
  type LlmResponse,
  type RewriteSectionRequest,
} from './llm-client.js';
import {
  buildRewriteContent,
  buildUserContent,
  REWRITE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from './prompt.js';

export interface AnthropicLlmOptions {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  /** Per request; the SDK retries transient errors inside it (`maxRetries`). */
  timeoutMs: number;
}

// Built once: the JSON schema the API constrains the answer to (AC-6.6).
const OUTPUT_FORMAT = zodOutputFormat(llmCvOutputSchema);

/**
 * Generation through the Anthropic Messages API with structured outputs (`output_config.format`
 * from the Zod schema). Forced `tool_choice` is not used: current models reject it. Server-side
 * refusal fallbacks are on. The answer is returned unparsed-by-trust: the pipeline validates it
 * with Zod and grounding. Logs ids, tokens, and duration only, never prompt or response text.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly logger = new Logger(AnthropicLlmClient.name);
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicLlmOptions) {
    // maxRetries: transient errors (429, 5xx, 529, network) are retried within one attempt,
    // honoring `retry-after`; BullMQ attempts and the job deadline bound the rest (NFR-R3).
    this.client = new Anthropic({
      apiKey: options.apiKey,
      maxRetries: 2,
      timeout: options.timeoutMs,
    });
  }

  generateCv(request: GenerateCvRequest): Promise<LlmResponse> {
    return this.call('generate', SYSTEM_PROMPT, buildUserContent(request), request.signal);
  }

  /** One part rewritten after an answer (AC-9.1): same output schema, scoped instructions. */
  rewriteSection(request: RewriteSectionRequest): Promise<LlmResponse> {
    return this.call(
      'rewrite_section',
      REWRITE_SYSTEM_PROMPT,
      buildRewriteContent(request),
      request.signal,
    );
  }

  private async call(
    task: string,
    system: string,
    content: string,
    signal: AbortSignal,
  ): Promise<LlmResponse> {
    const started = Date.now();
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.options.model,
          max_tokens: this.options.maxTokens,
          system,
          messages: [{ role: 'user', content }],
          output_config: { effort: this.options.effort, format: OUTPUT_FORMAT },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal },
      );
    } catch (error) {
      throw classifyLlmError(error);
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
    this.logger.log(
      {
        task,
        model: response.model,
        stopReason: response.stop_reason,
        durationMs: Date.now() - started,
        ...usage,
      },
      'LLM call finished',
    );
    if (response.stop_reason === 'refusal') {
      throw new LlmError('The model declined the request', false);
    }

    // The last text block holds the JSON answer (thinking and fallback blocks come before it).
    const text = response.content.filter((b) => b.type === 'text').at(-1)?.text ?? '';
    let output: unknown = text;
    try {
      output = JSON.parse(text);
    } catch {
      // Truncated (max_tokens) or not JSON: the schema rejects it and the pipeline re-requests.
    }
    return { output, usage };
  }
}
