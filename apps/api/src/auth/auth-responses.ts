import { ErrorCode, isErrorCode, type ApiError } from '@cv/shared';
import type { NextFunction, Request, Response } from 'express';

const EMAIL_TAKEN: ApiError = {
  code: ErrorCode.EMAIL_TAKEN,
  message: 'An account with this email already exists',
};
const INVALID_CREDENTIALS: ApiError = {
  code: ErrorCode.INVALID_CREDENTIALS,
  message: 'Invalid email or password',
};

/** better-auth error codes we expose under our own codes; everything else is generic. */
const KNOWN: Record<string, ApiError> = {
  USER_ALREADY_EXISTS: EMAIL_TAKEN,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: EMAIL_TAKEN,
  INVALID_EMAIL_OR_PASSWORD: INVALID_CREDENTIALS,
  INVALID_EMAIL: INVALID_CREDENTIALS,
  INVALID_PASSWORD: INVALID_CREDENTIALS,
};

const BY_STATUS: Partial<Record<number, ApiError>> = {
  401: { code: ErrorCode.UNAUTHORIZED, message: 'Authentication required' },
  403: { code: ErrorCode.FORBIDDEN, message: 'Forbidden' },
  404: { code: ErrorCode.NOT_FOUND, message: 'Not found' },
  415: { code: ErrorCode.UNSUPPORTED_MEDIA_TYPE, message: 'Unsupported media type' },
  429: { code: ErrorCode.RATE_LIMITED, message: 'Too many attempts, try later' },
};
const UNAVAILABLE: ApiError = {
  code: ErrorCode.SERVICE_UNAVAILABLE,
  message: 'Service unavailable',
};
const INVALID: ApiError = { code: ErrorCode.VALIDATION_ERROR, message: 'Invalid request' };

/**
 * Maps a better-auth error response to our `{ code, message, fields? }`. Bodies that already
 * use one of our codes (the Zod check in the `before` hook) pass through. A 5xx means the
 * session store or database failed and becomes 503.
 */
export function toAuthApiError(status: number, raw: unknown): { status: number; body: ApiError } {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ApiError>;
  if (status >= 500) return { status: 503, body: UNAVAILABLE };
  if (isErrorCode(body.code) && typeof body.message === 'string') {
    const { code, message, fields } = body;
    return { status, body: fields ? { code, message, fields } : { code, message } };
  }
  const known = typeof body.code === 'string' ? KNOWN[body.code] : undefined;
  return { status, body: known ?? BY_STATUS[status] ?? INVALID };
}

function parse(chunks: Buffer[]): unknown {
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

/** better-auth also returns the session token in these JSON bodies (for bearer clients). */
const TOKEN_IN_BODY = new Set(['/api/auth/sign-up/email', '/api/auth/sign-in/email']);

/**
 * Drops `token` from a successful sign-up / sign-in body: the session lives only in the
 * httpOnly cookie, so page scripts (and an XSS) never see it.
 */
export function withoutSessionToken(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('token' in raw)) return raw;
  const { token: _token, ...rest } = raw as Record<string, unknown>;
  return rest;
}

type Chunk = string | Buffer | Uint8Array;
/** `writeHead`, `write`, and `end` are overloaded; we only forward their arguments. */
type Forward = (this: Response, ...args: unknown[]) => unknown;

/**
 * Wraps the better-auth handler (`AuthModule` `middleware` option) and rewrites two kinds of
 * response bodies:
 * - every error from `/api/auth/*` leaves in the API's error shape. Endpoint errors, its Origin
 *   check, and its rate limiter (which answers before any hook runs) all end up here;
 * - successful sign-up / sign-in bodies lose the session token (`withoutSessionToken`).
 *
 * better-call sets headers with `setHeader`, then calls `writeHead(status)` and streams the
 * body; for those responses we buffer the body and send the rewritten one instead.
 */
export function rewriteAuthResponses(req: Request, res: Response, next: NextFunction): void {
  const target = res as unknown as Record<'writeHead' | 'write' | 'end', Forward>;
  const original = { writeHead: target.writeHead, write: target.write, end: target.end };
  const stripsToken = TOKEN_IN_BODY.has((req.originalUrl ?? req.url).split('?')[0]!);
  const chunks: Buffer[] = [];
  let bufferedStatus = 0;

  const restore = () => Object.assign(target, original);

  target.writeHead = function (status, ...rest) {
    const code = status as number;
    if (code < 400 && !(stripsToken && code < 300)) {
      restore();
      return original.writeHead.call(this, status, ...rest);
    }
    bufferedStatus = code;
    return this;
  };

  target.write = function (chunk, ...rest) {
    if (!bufferedStatus) return original.write.call(this, chunk, ...rest);
    chunks.push(Buffer.from(chunk as Chunk));
    return true;
  };

  target.end = function (chunk, ...rest) {
    if (!bufferedStatus) return original.end.call(this, chunk, ...rest);
    if (chunk && typeof chunk !== 'function') chunks.push(Buffer.from(chunk as Chunk));
    restore();
    const { status, body } =
      bufferedStatus >= 400
        ? toAuthApiError(bufferedStatus, parse(chunks))
        : { status: bufferedStatus, body: withoutSessionToken(parse(chunks)) };
    this.removeHeader('content-length');
    this.setHeader('content-type', 'application/json; charset=utf-8');
    this.statusCode = status;
    original.writeHead.call(this, status);
    return original.end.call(this, JSON.stringify(body));
  };

  next();
}
