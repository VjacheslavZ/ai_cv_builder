import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorCode, type ApiError } from '@cv/shared';
import { isAPIError } from 'better-auth/api';
import type { Response } from 'express';
import { ApiException } from './api.exception.js';

/** Generic messages for framework errors: their own messages can echo request details. */
const BY_STATUS: Partial<Record<number, ApiError>> = {
  400: { code: ErrorCode.VALIDATION_ERROR, message: 'Invalid request' },
  401: { code: ErrorCode.UNAUTHORIZED, message: 'Authentication required' },
  403: { code: ErrorCode.FORBIDDEN, message: 'Forbidden' },
  404: { code: ErrorCode.NOT_FOUND, message: 'Not found' },
  413: { code: ErrorCode.PAYLOAD_TOO_LARGE, message: 'Payload too large' },
  415: { code: ErrorCode.UNSUPPORTED_MEDIA_TYPE, message: 'Unsupported media type' },
  429: { code: ErrorCode.RATE_LIMITED, message: 'Too many requests' },
  503: { code: ErrorCode.SERVICE_UNAVAILABLE, message: 'Service unavailable' },
};

const INTERNAL: ApiError = { code: ErrorCode.INTERNAL, message: 'Internal server error' };

export function toErrorResponse(exception: unknown): { status: number; body: ApiError } {
  if (exception instanceof ApiException) {
    return { status: exception.status, body: exception.toBody() };
  }
  if (isAPIError(exception)) {
    // Thrown by better-auth inside the AuthGuard's session lookup. A 5xx means the session
    // store (Redis) failed: fail closed with 503, never as anonymous or authenticated (NFR-R12).
    if (exception.statusCode >= 500) {
      return { status: HttpStatus.SERVICE_UNAVAILABLE, body: BY_STATUS[503]! };
    }
    if (exception.statusCode === 401) return { status: 401, body: BY_STATUS[401]! };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const known = BY_STATUS[status];
    if (known) return { status, body: known };
    if (status < 500) return { status, body: { ...BY_STATUS[400]!, message: 'Request failed' } };
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: INTERNAL };
}

/** Every error leaves the API as `{ code, message, fields? }`: no stack traces, no SQL. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = toErrorResponse(exception);

    if (status >= 500) {
      // The stack stays in the server log; it never reaches the client.
      this.logger.error({ err: exception, code: body.code }, 'Unhandled error');
    }

    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json(body);
  }
}
