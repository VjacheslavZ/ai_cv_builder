import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api-fetch';
import { shouldRetry } from './query-client';

const apiError = (status: number) =>
  new ApiRequestError(status, { code: 'INTERNAL', message: 'x' });

describe('shouldRetry', () => {
  it('never retries client errors', () => {
    for (const status of [400, 401, 404, 409, 429]) {
      expect(shouldRetry(0, apiError(status))).toBe(false);
    }
  });

  it('retries server and network errors twice', () => {
    expect(shouldRetry(0, apiError(503))).toBe(true);
    expect(shouldRetry(1, apiError(0))).toBe(true);
    expect(shouldRetry(2, apiError(503))).toBe(false);
  });
});
