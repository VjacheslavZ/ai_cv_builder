import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ErrorCode } from '@cv/shared';
import { ApiException } from '../errors/api.exception.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_MEDIA_TYPES = new Set(['application/json', 'multipart/form-data']);
/** better-auth checks Origin on its own routes and reads their raw body. */
const AUTH_PATH = /^\/api\/auth(?:\/|$)/;

function hasBody(req: Request): boolean {
  const length = req.headers['content-length'];
  return req.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0');
}

function send(res: Response, error: ApiException): void {
  res.status(error.status).json(error.toBody());
}

/**
 * CSRF defence for mutating requests on non-auth routes (NFR-S3): `Origin` must be present and
 * equal the web origin, and a body must be JSON or multipart (no form-encoded or text/plain
 * "simple" requests). Runs before body parsing.
 */
export function originCheck(webOrigin: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING.has(req.method) || AUTH_PATH.test(req.path)) return next();

    if (req.headers.origin !== webOrigin) {
      return send(res, new ApiException(ErrorCode.FORBIDDEN, 'Forbidden'));
    }
    if (hasBody(req)) {
      const mediaType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
        return send(
          res,
          new ApiException(ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Unsupported media type'),
        );
      }
    }
    next();
  };
}
