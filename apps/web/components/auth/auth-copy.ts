import { ErrorCode } from '@cv/shared';
import { ApiRequestError } from '@/lib/api-fetch';

export type AuthMode = 'sign-in' | 'sign-up';

/** Texts of the login and sign-up forms. */
export const AUTH_COPY = {
  'sign-in': {
    title: 'Log in',
    submit: 'Log in',
    pending: 'Logging in…',
    alt: { text: 'No account yet?', href: '/signup', link: 'Sign up' },
  },
  'sign-up': {
    title: 'Create an account',
    submit: 'Sign up',
    pending: 'Creating account…',
    alt: { text: 'Already have an account?', href: '/login', link: 'Log in' },
  },
} as const satisfies Record<AuthMode, unknown>;

/** The message shown above the submit button for a failed request. */
export function formMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return 'Something went wrong. Try again.';
  switch (error.code) {
    case ErrorCode.INVALID_CREDENTIALS:
      return 'Invalid email or password';
    case ErrorCode.RATE_LIMITED:
      return 'Too many attempts, try later';
    case ErrorCode.SERVICE_UNAVAILABLE:
      return 'The service is unavailable. Try again in a moment.';
    default:
      return error.message;
  }
}
