import type { SessionView, SignInInput, SignUpInput } from '@cv/shared';
import { apiFetch } from './api-fetch';

// Thin wrappers over better-auth's endpoints. All logic (validation, hashing, sessions, rate
// limits) is in the API; errors arrive as `ApiRequestError` with our codes.

export function signUp(input: SignUpInput): Promise<unknown> {
  return apiFetch('/api/auth/sign-up/email', { method: 'POST', json: input });
}

export function signIn(input: SignInInput): Promise<unknown> {
  return apiFetch('/api/auth/sign-in/email', { method: 'POST', json: input });
}

export function signOut(): Promise<unknown> {
  return apiFetch('/api/auth/sign-out', { method: 'POST', json: {} });
}

/** `null` when there is no session. */
export function getSession(): Promise<SessionView | null> {
  return apiFetch<SessionView | null>('/api/auth/get-session');
}
