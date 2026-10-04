import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { classifyLlmError } from './classify-error.js';
import { LlmError } from './llm-client.js';

const apiError = (status: number) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x' } }, 'x', new Headers());

describe('classifyLlmError (AC-5.5, AC-5.6)', () => {
  it.each([
    ['429 rate limit', apiError(429), true],
    ['500 internal', apiError(500), true],
    ['502 bad gateway', apiError(502), true],
    ['503 unavailable', apiError(503), true],
    ['529 overloaded', apiError(529), true],
    ['408 timeout', apiError(408), true],
    ['400 bad request', apiError(400), false],
    ['401 bad key', apiError(401), false],
    ['403 forbidden', apiError(403), false],
    ['404 unknown model', apiError(404), false],
    ['connection error', new Anthropic.APIConnectionError({ message: 'reset' }), true],
    ['connection timeout', new Anthropic.APIConnectionTimeoutError(), true],
    ['aborted by our deadline', new Anthropic.APIUserAbortError(), true],
    ['an unknown error', new TypeError('boom'), true],
  ])('%s → retryable: %s', (_, error, retryable) => {
    const classified = classifyLlmError(error);
    expect(classified).toBeInstanceOf(LlmError);
    expect(classified.retryable).toBe(retryable);
  });

  it('keeps the status and passes LlmError through', () => {
    expect(classifyLlmError(apiError(401)).status).toBe(401);
    const own = new LlmError('x', false);
    expect(classifyLlmError(own)).toBe(own);
  });
});
