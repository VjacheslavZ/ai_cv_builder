import type { NestExpressApplication } from '@nestjs/platform-express';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/app.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { REDIS_COMMAND } from './support/global-setup.js';

describe('/ready', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db?.drop();
  });

  describe('Redis goes down', () => {
    // A dedicated Redis: stopping the shared one would break other test files.
    let redis: StartedRedisContainer | undefined;
    let app: NestExpressApplication;

    beforeAll(async () => {
      redis = await new RedisContainer('redis:7').withCommand(REDIS_COMMAND).start();
      app = await createTestApp({ databaseUrl: db.url, redisUrl: redis.getConnectionUrl() });
    });

    afterAll(async () => {
      await app?.close();
      await redis?.stop();
    });

    it('is 200 while Postgres and Redis are up, 503 once Redis stops', async () => {
      await request(app.getHttpServer()).get('/ready').expect(200, { status: 'ok' });

      await redis!.stop();
      redis = undefined;

      const res = await request(app.getHttpServer()).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' });

      // Liveness does not depend on dependencies.
      await request(app.getHttpServer()).get('/health').expect(200);
    });
  });

  describe('Postgres unreachable', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createTestApp({ databaseUrl: 'postgresql://cv:cv@127.0.0.1:1/cv' });
    });

    afterAll(async () => {
      await app?.close();
    });

    it('is 503', async () => {
      const res = await request(app.getHttpServer()).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    });
  });
});
