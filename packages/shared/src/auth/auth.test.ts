import { describe, expect, it } from 'vitest';
import { signInSchema, signUpSchema } from './index.js';

const names = { firstName: 'Ada', lastName: 'Lovelace' };

describe('signUpSchema', () => {
  it('accepts 8 to 128 characters and trims the email', () => {
    expect(signUpSchema.parse({ ...names, email: ' a@b.co ', password: '12345678' })).toEqual({
      ...names,
      email: 'a@b.co',
      password: '12345678',
    });
    expect(
      signUpSchema.safeParse({ ...names, email: 'a@b.co', password: 'x'.repeat(128) }).success,
    ).toBe(true);
  });

  it('rejects short and long passwords and bad emails', () => {
    expect(signUpSchema.safeParse({ ...names, email: 'a@b.co', password: '1234567' }).success).toBe(
      false,
    );
    expect(
      signUpSchema.safeParse({ ...names, email: 'a@b.co', password: 'x'.repeat(129) }).success,
    ).toBe(false);
    expect(signUpSchema.safeParse({ ...names, email: 'nope', password: '12345678' }).success).toBe(
      false,
    );
  });

  it('requires trimmed first and last names up to 100 characters', () => {
    const base = { email: 'a@b.co', password: '12345678' };
    expect(
      signUpSchema.parse({ ...base, firstName: ' Ada ', lastName: ' Lovelace ' }),
    ).toMatchObject(names);
    for (const bad of [
      {},
      { firstName: '  ', lastName: 'L' },
      { firstName: 'A', lastName: 'x'.repeat(101) },
    ]) {
      expect(signUpSchema.safeParse({ ...base, ...bad }).success).toBe(false);
    }
  });

  it('strips unknown keys such as userId', () => {
    expect(
      signUpSchema.parse({ ...names, email: 'a@b.co', password: '12345678', userId: 'x' }),
    ).not.toHaveProperty('userId');
  });
});

describe('signInSchema', () => {
  it('does not apply the sign-up length policy', () => {
    expect(signInSchema.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(true);
    expect(signInSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});
