/**
 * Every error the API returns carries one of these codes. The client switches on `code`,
 * never on `message` (messages are for humans and may change).
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Sign-in failed. Same code and message for a wrong password and an unknown email (AC-1.3). */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  /** A mutating request from a foreign or missing `Origin` (NFR-S3). */
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  ACTIVE_JOB_EXISTS: 'ACTIVE_JOB_EXISTS',
  /** Retry on a CV that is not failed, or whose saved source cannot be generated again (AC-5.6). */
  CANNOT_RETRY: 'CANNOT_RETRY',
  /** The CV has no draft yet (still generating, or the generation failed): nothing to edit or export. */
  CV_NOT_EDITABLE: 'CV_NOT_EDITABLE',
  /** Answer or skip on a question that is not `open` or `failed` (AC-8.6). */
  QUESTION_NOT_OPEN: 'QUESTION_NOT_OPEN',
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
