import { randomInt, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect } from 'vitest';
import { TEST_ORIGIN } from './app.js';

export const SESSION_COOKIE = 'cv.session_token';
export const PASSWORD = 'correct horse battery';
export const NAMES = { firstName: 'Ada', lastName: 'Lovelace' };

/** A fresh client address: rate-limit counters are per IP, and tests share one Redis. */
export function randomIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

export function randomEmail(): string {
  return `user-${randomUUID()}@example.com`;
}

/** The `Set-Cookie` line of the session cookie, if the response set one. */
export function sessionSetCookie(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
}

/** `cv.session_token=…` for a `Cookie` header. */
export function sessionCookie(res: request.Response): string {
  const line = sessionSetCookie(res);
  expect(line, 'response sets the session cookie').toBeDefined();
  return line!.split(';')[0]!;
}

/** The session token as stored in Redis: the cookie value is `<token>.<signature>`. */
export function sessionToken(cookie: string): string {
  const value = decodeURIComponent(cookie.slice(`${SESSION_COOKIE}=`.length));
  return value.slice(0, value.lastIndexOf('.'));
}

export function authPost(
  app: NestExpressApplication,
  path: string,
  body: object,
  ip: string = randomIp(),
) {
  return request(app.getHttpServer())
    .post(`/api/auth${path}`)
    .set('Origin', TEST_ORIGIN)
    .set('X-Forwarded-For', ip)
    .send(body);
}

/** Signs up a new user and returns their email and session cookie. */
export async function signUp(app: NestExpressApplication, email: string = randomEmail()) {
  const res = await authPost(app, '/sign-up/email', { ...NAMES, email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { email, cookie: sessionCookie(res), userId: res.body.user.id as string };
}
