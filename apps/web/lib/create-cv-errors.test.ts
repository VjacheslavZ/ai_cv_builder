import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api-fetch';
import { createCvErrors } from './create-cv-errors';

describe('createCvErrors', () => {
  it('puts 400 field errors on known fields only', () => {
    const error = new ApiRequestError(400, {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      fields: { role: 'Too long', 'Idempotency-Key': 'Bad key' },
    });
    expect(createCvErrors(error)).toEqual([['role', 'Too long']]);
  });

  it('puts 413 and 415 on the file', () => {
    const tooLarge = new ApiRequestError(413, { code: 'PAYLOAD_TOO_LARGE', message: 'x' });
    const notPdf = new ApiRequestError(415, { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'x' });
    expect(createCvErrors(tooLarge)).toEqual([['file', 'The PDF must be 10 MB or smaller']]);
    expect(createCvErrors(notPdf)).toEqual([['file', 'This file is not a PDF']]);
  });

  it('shows anything else above the submit button', () => {
    const limited = new ApiRequestError(429, { code: 'RATE_LIMITED', message: 'Try later' });
    expect(createCvErrors(limited)).toEqual([['root', 'Try later']]);
    expect(createCvErrors(new Error('boom'))).toEqual([
      ['root', 'Something went wrong. Try again.'],
    ]);
  });
});
