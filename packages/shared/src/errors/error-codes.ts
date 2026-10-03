/**
 * Every error the API returns carries one of these codes. The client switches on `code`,
 * never on `message` (messages are for humans and may change).
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  ACTIVE_JOB_EXISTS: 'ACTIVE_JOB_EXISTS',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  PDF_NO_TEXT: 'PDF_NO_TEXT',
  PDF_ENCRYPTED: 'PDF_ENCRYPTED',
  PDF_CORRUPTED: 'PDF_CORRUPTED',
  PDF_TOO_MANY_PAGES: 'PDF_TOO_MANY_PAGES',
  PDF_EXPIRED: 'PDF_EXPIRED',
  LLM_UNAVAILABLE: 'LLM_UNAVAILABLE',
  LLM_INVALID_OUTPUT: 'LLM_INVALID_OUTPUT',
  JOB_TIMEOUT: 'JOB_TIMEOUT',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_CODES = Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
