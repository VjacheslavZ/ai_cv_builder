import { Inject } from '@nestjs/common';
import type { SourceKind } from '../generated/prisma/enums.js';

export interface GenerateCvRequest {
  /** A goal, never a fact (SPEC §0). */
  targetRole: string;
  /** The facts, in the order they were added. */
  sources: { kind: SourceKind; text: string }[];
  /** Why the previous answer was rejected, for a re-request (AC-6.6). */
  feedback?: string;
  /** Aborted when the call's time budget runs out. */
  signal: AbortSignal;
}

export interface LlmResponse {
  /** Untrusted: validated by the pipeline before it can touch a CV (NFR-R5). */
  output: unknown;
  usage?: { inputTokens: number; outputTokens: number };
}

/** The only way the app talks to an LLM. Phase 2 ships the fake; Phase 3 adds Anthropic. */
export interface LlmClient {
  generateCv(request: GenerateCvRequest): Promise<LlmResponse>;
}

/**
 * A failed call. `retryable` (429, 5xx, overloaded, network, timeout) lets BullMQ back off and
 * retry; anything else is permanent (400, 401) and fails the job at once (AC-5.5, AC-5.6).
 */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');
export const InjectLlmClient = () => Inject(LLM_CLIENT);
