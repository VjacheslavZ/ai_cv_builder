import Anthropic from '@anthropic-ai/sdk';
import { LlmError } from './llm-client.js';

/** Statuses retrying cannot fix: bad request, bad key, no access, unknown model, too large. */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 413, 422]);

/**
 * Turns anything the Anthropic SDK throws into an `LlmError` (AC-5.5, AC-5.6): `429`, `5xx`,
 * `529` overloaded, connection errors, and timeouts are retryable (BullMQ backs off and tries
 * again); `400`, `401`, `403`, `404` are permanent. Unknown errors are retryable: the attempt
 * limit and the job deadline still bound them.
 */
export function classifyLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  // Covers APIConnectionError, APIConnectionTimeoutError, and APIUserAbortError (our deadline).
  if (error instanceof Anthropic.APIError && error.status === undefined) {
    return new LlmError(error.name, true);
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status!;
    return new LlmError(`Anthropic API ${status}`, !PERMANENT_STATUSES.has(status), status);
  }
  return new LlmError((error as Error | undefined)?.name ?? 'Unknown LLM error', true);
}
