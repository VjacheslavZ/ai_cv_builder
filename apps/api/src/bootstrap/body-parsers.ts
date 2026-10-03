import { HttpException } from '@nestjs/common';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { toErrorResponse } from '../common/errors/all-exceptions.filter.js';

/** better-auth reads the raw body itself; parsing it first breaks it (SPEC §7, risk #1). */
const AUTH_PATH = /^\/api\/auth(?:\/|$)/;

/**
 * The app is created with `bodyParser: false`; this re-enables JSON and urlencoded parsing
 * for every path except `/api/auth/*`. Parser errors (too large, malformed) are answered here
 * because Express middleware errors never reach Nest's exception filter.
 */
export function bodyParsersExceptAuth(limit: string): RequestHandler {
  const parsers = [express.json({ limit }), express.urlencoded({ extended: false, limit })];

  return (req: Request, res: Response, next: NextFunction) => {
    if (AUTH_PATH.test(req.path)) return next();

    const run = (index: number): void => {
      const parser = parsers[index];
      if (!parser) return next();
      parser(req, res, (err?: unknown) => {
        if (!err) return run(index + 1);
        const status = (err as { status?: number }).status ?? 400;
        const { body } = toErrorResponse(new HttpException('Body parse error', status));
        res
          .status(status)
          .json(
            (err as { type?: string }).type === 'entity.parse.failed'
              ? { ...body, message: 'Malformed request body' }
              : body,
          );
      });
    };
    run(0);
  };
}
