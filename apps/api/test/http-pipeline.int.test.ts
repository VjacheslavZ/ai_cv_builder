import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp, TEST_ORIGIN } from './support/app.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';

const echoSchema = z.object({ role: z.string().min(1).max(10) });

@AllowAnonymous()
@Controller('test')
class TestController {
  @Post('echo')
  echo(@Body() body: unknown) {
    return { body };
  }

  @Post('validated')
  validated(@Body({ schema: echoSchema }) body: z.infer<typeof echoSchema>) {
    return { body };
  }

  @Get('boom')
  boom() {
    throw new Error('connection to "users" failed: SELECT password FROM users');
  }
}

describe('HTTP pipeline', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createTestApp({
      databaseUrl: db.url,
      env: { JSON_BODY_LIMIT: '2kb' },
      controllers: [TestController],
    });
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  describe('body parsing (bodyParser: false regression guard)', () => {
    it('parses JSON on non-auth routes', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/test/echo')
        .set('Origin', TEST_ORIGIN)
        .send({ hello: 'world', nested: { n: 1 } });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ body: { hello: 'world', nested: { n: 1 } } });
    });

    // `/api/auth/*` bodies reaching better-auth unparsed is covered by auth.int.test.ts:
    // sign-up and sign-in only work if our parsers left the stream alone.

    it('rejects malformed JSON with VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/test/echo')
        .set('Origin', TEST_ORIGIN)
        .set('Content-Type', 'application/json')
        .send('{"broken":');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ code: 'VALIDATION_ERROR', message: 'Malformed request body' });
    });

    it('rejects bodies over the limit with PAYLOAD_TOO_LARGE', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/test/echo')
        .set('Origin', TEST_ORIGIN)
        .send({ text: 'x'.repeat(4096) });
      expect(res.status).toBe(413);
      expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('validation', () => {
    it('strips unknown keys', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/test/validated')
        .set('Origin', TEST_ORIGIN)
        .send({ role: 'Dev', userId: 'someone-else' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ body: { role: 'Dev' } });
    });

    it('returns 400 { code, message, fields }', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/test/validated')
        .set('Origin', TEST_ORIGIN)
        .send({ role: 'way too long for ten' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        fields: { role: expect.any(String) },
      });
    });
  });

  describe('errors', () => {
    it('returns { code, message } without stack traces or SQL', async () => {
      const res = await request(app.getHttpServer()).get('/api/test/boom');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ code: 'INTERNAL', message: 'Internal server error' });
      expect(res.text).not.toMatch(/SELECT|password|\.ts:\d+/);
    });

    it('returns NOT_FOUND for unknown routes', async () => {
      const res = await request(app.getHttpServer()).get('/api/nope');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    });
  });

  describe('routing and headers', () => {
    it('serves probes outside the /api prefix', async () => {
      await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
      await request(app.getHttpServer()).get('/api/health').expect(404);
    });

    it('sets security headers', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('echoes a valid X-Request-Id and generates one otherwise', async () => {
      const given = await request(app.getHttpServer())
        .get('/api/nope')
        .set('X-Request-Id', 'req-123');
      expect(given.headers['x-request-id']).toBe('req-123');

      const generated = await request(app.getHttpServer())
        .get('/api/nope')
        .set('X-Request-Id', '<script>');
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
