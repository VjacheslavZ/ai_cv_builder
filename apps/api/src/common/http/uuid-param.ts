import { Param, ParseUUIDPipe } from '@nestjs/common';
import { ErrorCode } from '@cv/shared';
import { ApiException } from '../errors/api.exception.js';

/**
 * A UUID route parameter. Anything else is `404 NOT_FOUND`, like an id that does not exist or
 * belongs to someone else (`ownedOrNotFound`), and never reaches a `uuid` column.
 */
export const UuidParam = (name: string) =>
  Param(
    name,
    new ParseUUIDPipe({
      exceptionFactory: () => new ApiException(ErrorCode.NOT_FOUND, 'Not found'),
    }),
  );
