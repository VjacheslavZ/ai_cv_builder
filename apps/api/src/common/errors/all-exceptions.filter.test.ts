import {
  BadRequestException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ErrorCode } from '@cv/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter, toErrorResponse } from './all-exceptions.filter.js';
import { ApiException } from './api.exception.js';

function httpHost() {
  const res = { headersSent: false, status: vi.fn(), json: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res);
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('AllExceptionsFilter', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  it('sends an ApiException as { code, message, fields }', () => {
    const { host, res } = httpHost();
    const error = new ApiException(ErrorCode.VALIDATION_ERROR, 'Invalid request', {
      fields: { role: 'Required' },
    });
    new AllExceptionsFilter().catch(error, host);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      fields: { role: 'Required' },
    });
  });

  it('turns unknown errors into 500 INTERNAL without the stack or the message', () => {
    const { host, res } = httpHost();
    const error = new Error('relation "users" does not exist: SELECT * FROM users');
    new AllExceptionsFilter().catch(error, host);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0]?.[0];
    expect(body).toEqual({ code: 'INTERNAL', message: 'Internal server error' });
    expect(JSON.stringify(body)).not.toMatch(/SELECT|at .*\.ts/);
  });

  it('maps framework HTTP errors to codes with generic messages', () => {
    expect(toErrorResponse(new NotFoundException('Cannot GET /api/secret?email=a@b.c'))).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Not found' },
    });
    expect(toErrorResponse(new PayloadTooLargeException()).body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(toErrorResponse(new BadRequestException('details')).body).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
    });
  });

  it('only ends the response when headers were already sent (e.g. a broken SSE stream)', () => {
    const { host, res } = httpHost();
    res.headersSent = true;
    new AllExceptionsFilter().catch(new Error('late'), host);
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
