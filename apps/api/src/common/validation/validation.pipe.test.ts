import { ErrorCode } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiException } from '../errors/api.exception.js';
import { createValidationPipe } from './validation.pipe.js';

const schema = z.object({
  role: z.string().min(1).max(100),
  ops: z.array(z.object({ value: z.string().max(5) })).optional(),
});

describe('validation pipe', () => {
  const pipe = createValidationPipe();

  it('strips unknown keys and returns the parsed value', async () => {
    const value = await pipe.transform(
      { role: 'Backend Engineer', userId: 'injected' },
      { type: 'body', schema },
    );
    expect(value).toEqual({ role: 'Backend Engineer' });
  });

  it('throws 400 VALIDATION_ERROR with one message per field path', async () => {
    const error = await pipe
      .transform({ role: '', ops: [{ value: 'too long' }] }, { type: 'body', schema })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiException);
    const body = (error as ApiException).toBody();
    expect((error as ApiException).status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(Object.keys(body.fields ?? {}).sort()).toEqual(['ops.0.value', 'role']);
  });

  it('passes through parameters without a schema', async () => {
    expect(await pipe.transform('raw', { type: 'param' })).toBe('raw');
  });
});
