import { describe, expect, it } from 'vitest';
import { ApiException } from '../errors/api.exception.js';
import { ownedOrNotFound } from './owned.js';

describe('ownedOrNotFound', () => {
  it('returns the row', () => {
    const row = { id: '1' };
    expect(ownedOrNotFound(row)).toBe(row);
  });

  it('turns missing or not-owned (both null) into 404 NOT_FOUND, never 403', () => {
    for (const row of [null, undefined]) {
      const error = (() => {
        try {
          ownedOrNotFound(row);
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ApiException);
      expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    }
  });
});
