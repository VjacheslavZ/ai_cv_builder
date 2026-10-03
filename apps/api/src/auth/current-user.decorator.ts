import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ErrorCode, type AuthUser } from '@cv/shared';
import type { Request } from 'express';
import { ApiException } from '../common/errors/api.exception.js';

/**
 * The session's user as `{ id }`, the only owner a handler may use (AC-2.3). Never read the
 * owner from the body, params, or query.
 */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: { id?: unknown } | null }>();
  const id = req.user?.id;
  if (typeof id !== 'string') {
    // Only reachable on an `@AllowAnonymous()` route: a programming error, still fail closed.
    throw new ApiException(ErrorCode.UNAUTHORIZED, 'Authentication required');
  }
  return { id };
});
