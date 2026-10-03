import { ErrorCode } from '@cv/shared';
import { ApiException } from '../errors/api.exception.js';

/**
 * The ownership rule (NFR-S2): repositories always take `userId` and filter by it
 * (`findOwned(id, userId)`, `listOwned(userId)`, `deleteOwned(id, userId)`), so a row that
 * does not exist and a row owned by someone else look the same. Both become `404 NOT_FOUND`,
 * never `403`, so the response does not reveal that the id exists.
 */
export function ownedOrNotFound<T>(row: T | null | undefined): T {
  if (row === null || row === undefined) {
    throw new ApiException(ErrorCode.NOT_FOUND, 'Not found');
  }
  return row;
}
