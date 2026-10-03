import { describe, expect, it } from 'vitest';
import { apiErrorSchema, ErrorCode, isErrorCode } from './index.js';

describe('ApiError', () => {
  it('accepts the documented shape', () => {
    const body = {
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Invalid',
      fields: { role: 'Required' },
    };
    expect(apiErrorSchema.parse(body)).toEqual(body);
  });

  it('rejects unknown codes', () => {
    expect(apiErrorSchema.safeParse({ code: 'NOPE', message: 'x' }).success).toBe(false);
    expect(isErrorCode('NOPE')).toBe(false);
    expect(isErrorCode('NOT_FOUND')).toBe(true);
  });
});
