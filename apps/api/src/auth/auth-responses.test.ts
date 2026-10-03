import { describe, expect, it } from 'vitest';
import { toAuthApiError, withoutSessionToken } from './auth-responses.js';

describe('toAuthApiError', () => {
  it('maps better-auth codes to ours', () => {
    expect(
      toAuthApiError(422, { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', message: 'x' }),
    ).toEqual({
      status: 422,
      body: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists' },
    });
    expect(toAuthApiError(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'x' }).body).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('keeps bodies that already use our codes, fields included', () => {
    const body = { code: 'VALIDATION_ERROR', message: 'Invalid request', fields: { email: 'Bad' } };
    expect(toAuthApiError(400, body)).toEqual({ status: 400, body });
  });

  it('maps the rate limiter body (no code) by status', () => {
    expect(toAuthApiError(429, { message: 'Too many requests. Please try again later.' })).toEqual({
      status: 429,
      body: { code: 'RATE_LIMITED', message: 'Too many attempts, try later' },
    });
  });

  it('turns server errors into 503 and unknown 4xx into a generic VALIDATION_ERROR', () => {
    expect(toAuthApiError(500, { code: 'FAILED_TO_GET_SESSION' }).status).toBe(503);
    expect(toAuthApiError(400, 'not json').body).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
    });
  });
});

describe('withoutSessionToken', () => {
  it('removes the token and keeps the rest', () => {
    expect(withoutSessionToken({ token: 'secret', user: { id: '1' } })).toEqual({
      user: { id: '1' },
    });
    expect(withoutSessionToken(null)).toBeNull();
  });
});
