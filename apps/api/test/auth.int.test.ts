import { Body, Controller, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthUser } from '@cv/shared';
import { Redis } from 'ioredis';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { z } from 'zod';
import { AUTH_REDIS_PREFIX } from '../src/auth/auth.config.js';
import { CurrentUser } from '../src/auth/current-user.decorator.js';
import { createTestApp, TEST_ORIGIN } from './support/app.js';
import {
  authPost,
  NAMES,
  PASSWORD,
  randomEmail,
  randomIp,
  sessionCookie,
  sessionSetCookie,
  sessionToken,
  signUp,
} from './support/auth.js';
import { startOwnRedis, type OwnRedis } from './support/own-redis.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';

const createThingSchema = z.object({ title: z.string().min(1) });

/** A protected create endpoint standing in for Phase 2's `POST /api/cvs` (AC-2.3). */
@Controller('test-things')
class ThingsController {
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createThingSchema }) body: z.infer<typeof createThingSchema>,
  ) {
    return { ownerId: user.id, body };
  }
}

describe('auth', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let redis: Redis;

  const SIGN_IN_MAX = 3;
  const env = { SIGN_IN_RATE_LIMIT_MAX: String(SIGN_IN_MAX), SIGN_IN_RATE_LIMIT_WINDOW_S: '60' };

  async function usersWithEmail(email: string) {
    const client = new pg.Client({ connectionString: db.url });
    await client.connect();
    try {
      const { rows } = await client.query(
        'SELECT "firstName", "lastName" FROM users WHERE email = $1',
        [email],
      );
      return rows as { firstName: string; lastName: string }[];
    } finally {
      await client.end();
    }
  }
  const countUsers = async (email: string) => (await usersWithEmail(email)).length;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createTestApp({ databaseUrl: db.url, env, controllers: [ThingsController] });
    redis = new Redis(inject('redisUrl'));
  });

  afterAll(async () => {
    await app?.close();
    await redis?.quit();
    await db?.drop();
  });

  describe('sign up', () => {
    it('creates the account and sets an httpOnly, SameSite=Lax session cookie', async () => {
      const email = randomEmail();
      const res = await authPost(app, '/sign-up/email', {
        firstName: ' Ada ',
        lastName: 'Lovelace',
        email,
        password: PASSWORD,
      });

      expect(res.status).toBe(200);
      // The token lives only in the httpOnly cookie, never in a body page scripts can read.
      expect(res.body).not.toHaveProperty('token');
      expect(res.body.user).toMatchObject({ email });
      const cookie = sessionSetCookie(res)!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).not.toMatch(/Secure/i); // localhost
      expect(await usersWithEmail(email)).toEqual([{ firstName: 'Ada', lastName: 'Lovelace' }]);

      // The session lives in Redis only.
      const token = sessionToken(sessionCookie(res));
      expect(await redis.exists(`${AUTH_REDIS_PREFIX}${token}`)).toBe(1);

      await request(app.getHttpServer())
        .get('/api/cvs')
        .set('Cookie', sessionCookie(res))
        .expect(200, []);
    });

    it('rejects invalid input with VALIDATION_ERROR fields from the shared schema', async () => {
      const res = await authPost(app, '/sign-up/email', {
        firstName: ' ',
        email: 'nope',
        password: 'short',
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        fields: {
          firstName: expect.any(String),
          lastName: expect.any(String),
          email: expect.any(String),
          password: expect.any(String),
        },
      });
    });

    it('rejects a password over 128 characters', async () => {
      const res = await authPost(app, '/sign-up/email', {
        ...NAMES,
        email: randomEmail(),
        password: 'x'.repeat(129),
      });
      expect(res.status).toBe(400);
      expect(res.body.fields).toHaveProperty('password');
    });
  });

  describe('email already taken', () => {
    it('creates nothing and leaves the existing account unchanged', async () => {
      const { email } = await signUp(app);

      const res = await authPost(app, '/sign-up/email', {
        ...NAMES,
        email: email.toUpperCase(),
        password: 'another password 123',
      });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        code: 'EMAIL_TAKEN',
        message: 'An account with this email already exists',
      });
      expect(sessionSetCookie(res)).toBeUndefined();
      expect(await countUsers(email)).toBe(1);

      // The original password still works; the new one does not.
      expect((await authPost(app, '/sign-in/email', { email, password: PASSWORD })).status).toBe(
        200,
      );
      expect(
        (await authPost(app, '/sign-in/email', { email, password: 'another password 123' })).status,
      ).toBe(401);
    });
  });

  describe('invalid credentials', () => {
    it('answers a wrong password and an unknown email identically', async () => {
      const { email } = await signUp(app);
      const wrongPassword = await authPost(app, '/sign-in/email', {
        email,
        password: 'wrong password',
      });
      const unknownEmail = await authPost(app, '/sign-in/email', {
        email: randomEmail(),
        password: 'wrong password',
      });

      const expected = { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' };
      expect(wrongPassword.status).toBe(401);
      expect(wrongPassword.body).toEqual(expected);
      expect(unknownEmail.status).toBe(401);
      expect(unknownEmail.body).toEqual(expected);
      expect(sessionSetCookie(wrongPassword)).toBeUndefined();
    });
  });

  describe('log out', () => {
    it('deletes the session in Redis; the old cookie then gets 401', async () => {
      const { cookie } = await signUp(app);
      const key = `${AUTH_REDIS_PREFIX}${sessionToken(cookie)}`;
      expect(await redis.exists(key)).toBe(1);

      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-out')
        .set('Origin', TEST_ORIGIN)
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(200);
      expect(sessionSetCookie(res)).toMatch(/Max-Age=0/);

      expect(await redis.exists(key)).toBe(0);
      const after = await request(app.getHttpServer()).get('/api/cvs').set('Cookie', cookie);
      expect(after.status).toBe(401);
      expect(after.body).toEqual({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    });
  });

  describe('unauthenticated access', () => {
    it('returns 401 on a protected route without a cookie', async () => {
      const res = await request(app.getHttpServer()).get('/api/cvs');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    });

    it('returns 401 for a forged cookie', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/cvs')
        .set('Cookie', 'cv.session_token=forged.signature');
      expect(res.status).toBe(401);
    });

    it('keeps probes public', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
      await request(app.getHttpServer()).get('/ready').expect(200);
    });
  });

  describe('brute-force protection', () => {
    async function signInAttempts(ip: string, n: number): Promise<number[]> {
      const statuses: number[] = [];
      for (let i = 0; i < n; i++) {
        const res = await authPost(
          app,
          '/sign-in/email',
          { email: randomEmail(), password: 'wrong password' },
          ip,
        );
        statuses.push(res.status);
      }
      return statuses;
    }

    it('answers 429 over the limit, per client IP, and keeps counting after a restart', async () => {
      const ip = randomIp();
      expect(await signInAttempts(ip, SIGN_IN_MAX)).toEqual(Array(SIGN_IN_MAX).fill(401));
      expect(await signInAttempts(ip, 1)).toEqual([429]);

      const limited = await authPost(
        app,
        '/sign-in/email',
        { email: randomEmail(), password: 'x' },
        ip,
      );
      expect(limited.body).toEqual({
        code: 'RATE_LIMITED',
        message: 'Too many attempts, try later',
      });

      // Another X-Forwarded-For has its own counter.
      expect(await signInAttempts(randomIp(), 1)).toEqual([401]);

      // The counter is in Redis, not in the process.
      await app.close();
      app = await createTestApp({ databaseUrl: db.url, env, controllers: [ThingsController] });
      expect(await signInAttempts(ip, 1)).toEqual([429]);
    });
  });

  describe('CSRF (NFR-S3)', () => {
    it('rejects mutating requests with a foreign or missing Origin', async () => {
      const { cookie } = await signUp(app);
      const foreign = await request(app.getHttpServer())
        .post('/api/test-things')
        .set('Origin', 'https://evil.example')
        .set('Cookie', cookie)
        .send({ title: 'x' });
      expect(foreign.status).toBe(403);
      expect(foreign.body).toEqual({ code: 'FORBIDDEN', message: 'Forbidden' });

      const missing = await request(app.getHttpServer())
        .post('/api/test-things')
        .set('Cookie', cookie)
        .send({ title: 'x' });
      expect(missing.status).toBe(403);
    });

    it('rejects bodies that are not JSON or multipart', async () => {
      const { cookie } = await signUp(app);
      const res = await request(app.getHttpServer())
        .post('/api/test-things')
        .set('Origin', TEST_ORIGIN)
        .set('Cookie', cookie)
        .set('Content-Type', 'text/plain')
        .send('{"title":"x"}');
      expect(res.status).toBe(415);
      expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    // better-auth checks Origin on its own routes whenever the request carries cookies.
    it('rejects a cookie-bearing auth request from a foreign Origin', async () => {
      const { cookie } = await signUp(app);
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-out')
        .set('Origin', 'https://evil.example')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');

      // The session survived.
      await request(app.getHttpServer()).get('/api/cvs').set('Cookie', cookie).expect(200);
    });
  });

  describe('owner comes only from the session (AC-2.3)', () => {
    it('ignores userId and ownerId in the body', async () => {
      const victim = await signUp(app);
      const attacker = await signUp(app);

      const res = await request(app.getHttpServer())
        .post('/api/test-things')
        .set('Origin', TEST_ORIGIN)
        .set('Cookie', attacker.cookie)
        .send({ title: 'x', userId: victim.userId, ownerId: victim.userId });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ownerId: attacker.userId, body: { title: 'x' } });
    });
  });
});

describe('auth when Redis is down (NFR-R12)', () => {
  let db: TestDatabase;
  let redis: OwnRedis | undefined;
  let app: NestExpressApplication;

  beforeAll(async () => {
    db = await createTestDatabase();
    redis = await startOwnRedis();
    app = await createTestApp({ databaseUrl: db.url, redisUrl: redis.url });
  });

  afterAll(async () => {
    await app?.close();
    await redis?.close();
    await db?.drop();
  });

  it('fails closed with 503, never as anonymous or authenticated', async () => {
    const { cookie } = await signUp(app);
    await request(app.getHttpServer()).get('/api/cvs').set('Cookie', cookie).expect(200);

    redis!.stop();

    const res = await request(app.getHttpServer()).get('/api/cvs').set('Cookie', cookie);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' });

    // Without a cookie there is nothing to look up: still a plain 401.
    await request(app.getHttpServer()).get('/api/cvs').expect(401);
  });
});
