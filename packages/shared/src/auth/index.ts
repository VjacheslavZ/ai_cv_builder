import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** better-auth cookie prefix; the session cookie is `cv.session_token` (`__Secure-` over HTTPS). */
export const AUTH_COOKIE_PREFIX = 'cv';
export const SESSION_COOKIE_NAMES = [
  `${AUTH_COOKIE_PREFIX}.session_token`,
  `__Secure-${AUTH_COOKIE_PREFIX}.session_token`,
] as const;

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email')
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email'));

export const PERSON_NAME_MAX_LENGTH = 100;

const personName = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter your ${label}`)
    .max(PERSON_NAME_MAX_LENGTH, `Use at most ${PERSON_NAME_MAX_LENGTH} characters`);

/** Sign-up form and `POST /api/auth/sign-up/email`. */
export const signUpSchema = z.object({
  firstName: personName('first name'),
  lastName: personName('last name'),
  email: emailSchema,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Login form and `POST /api/auth/sign-in/email`. No minimum length beyond "not empty": a
 * policy hint here would tell an attacker something about the stored password.
 */
export const signInSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, 'Enter your password')
    .max(PASSWORD_MAX_LENGTH, 'Invalid email or password'),
});
export type SignInInput = z.infer<typeof signInSchema>;

/** The only user data the API hands to handlers (`@CurrentUser()`). */
export interface AuthUser {
  id: string;
}

/** `GET /api/auth/get-session` as the web app reads it. */
export interface SessionView {
  user: { id: string; email: string };
}
