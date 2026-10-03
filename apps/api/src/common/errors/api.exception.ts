import { HttpStatus } from '@nestjs/common';
import { ErrorCode, type ApiError } from '@cv/shared';

const DEFAULT_STATUS: Partial<Record<ErrorCode, HttpStatus>> = {
  [ErrorCode.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
  [ErrorCode.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.INVALID_CREDENTIALS]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.EMAIL_TAKEN]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.VERSION_CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.ACTIVE_JOB_EXISTS]: HttpStatus.CONFLICT,
  [ErrorCode.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [ErrorCode.PAYLOAD_TOO_LARGE]: HttpStatus.PAYLOAD_TOO_LARGE,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  [ErrorCode.SERVICE_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorCode.INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * The one exception type for expected errors. The global filter turns it into
 * `{ code, message, fields? }`; anything else becomes `500 INTERNAL`.
 */
export class ApiException extends Error {
  readonly status: HttpStatus;
  readonly fields?: Record<string, string>;
  readonly jobId?: string;

  constructor(
    readonly code: ErrorCode,
    message: string,
    options: { status?: HttpStatus; fields?: Record<string, string>; jobId?: string } = {},
  ) {
    super(message);
    this.name = 'ApiException';
    this.status = options.status ?? DEFAULT_STATUS[code] ?? HttpStatus.BAD_REQUEST;
    this.fields = options.fields;
    this.jobId = options.jobId;
  }

  toBody(): ApiError {
    return {
      code: this.code,
      message: this.message,
      ...(this.fields ? { fields: this.fields } : {}),
      ...(this.jobId ? { jobId: this.jobId } : {}),
    };
  }
}
