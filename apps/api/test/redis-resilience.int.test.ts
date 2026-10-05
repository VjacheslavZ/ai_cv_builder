import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Sweeper } from '../src/worker/sweeper.js';
import { createTestApp, TEST_ORIGIN, uniqueQueuePrefix } from './support/app.js';
import { PASSWORD, signUp } from './support/auth.js';
import { apiGet, createCv, postCv, waitFor, waitForJob } from './support/cvs.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { startOwnRedis, type OwnRedis } from './support/own-redis.js';
import { patchCv } from './support/ready-cv.js';
import { startTestWorker } from './support/worker.js';

/**
 * NFR-R11, NFR-R12, AC-5.7a against a real Redis that restarts, goes away, and comes back empty.
 * Redis holds sessions and the queue; Postgres keeps everything that matters.
 */
describe('Redis restart and outage', () => {
  let db: TestDatabase;
  let redis: OwnRedis;
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let env: Record<string, string>;
  const workers: TestingModule[] = [];

  beforeAll(async () => {
    db = await createTestDatabase();
    redis = await startOwnRedis();
    env = { BULLMQ_PREFIX: uniqueQueuePrefix(), SWEEPER_REQUEUE_AFTER_MS: '1' };
    app = await createTestApp({ databaseUrl: db.url, redisUrl: redis.url, env });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const worker of workers) await worker.close();
    await app?.close();
    await redis?.close();
    await db?.drop();
  });

  async function startWorker() {
    const worker = await startTestWorker({
      databaseUrl: db.url,
      redisUrl: redis.url,
      env,
      llm: new FakeLlmClient(),
    });
    workers.push(worker);
    return worker;
  }

  /** Waits until the API reaches Redis again (clients reconnect on their own). */
  function waitForApi(cookie: string, status = 200) {
    return waitFor(async () => (await apiGet(app, '/api/cvs', cookie)).status === status, {
      timeoutMs: 15_000,
      what: `GET /api/cvs to answer ${status}`,
    });
  }

  it('a restart keeps the session and the queued job (NFR-R11)', async () => {
    const { cookie } = await signUp(app);
    // No worker yet: the job waits in Redis through the restart.
    const { jobId } = await createCv(app, {
      cookie,
      text: 'Acme Corp - Engineer\nShipped things.',
    });

    redis.restart();
    await waitForApi(cookie);

    const worker = await startWorker();
    expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).status).toBe('completed');
    await worker.close();
    workers.splice(workers.indexOf(worker), 1);
  });

  it('an outage answers 503, loses nothing, and recovers with the same session (NFR-R12)', async () => {
    const { cookie } = await signUp(app);
    const worker = await startWorker();
    const { cvId, jobId } = await createCv(app, {
      cookie,
      text: 'Acme Corp - Engineer\nShipped things.',
    });
    expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).status).toBe('completed');
    const before = await prisma.cv.findUniqueOrThrow({ where: { id: cvId } });

    redis.stop();
    try {
      expect((await apiGet(app, '/api/cvs', cookie)).status).toBe(503);
      expect((await apiGet(app, `/api/cvs/${cvId}`, cookie)).status).toBe(503);
      const patched = await patchCv(app, cvId, cookie, {
        baseVersion: before.version,
        ops: [{ op: 'set', path: 'summary', value: 'Written during the outage' }],
      });
      expect(patched.status).toBe(503);
      expect((await postCv(app, { cookie, role: 'Dev', text: 'x' })).status).toBe(503);
      // Postgres is untouched: nothing half-written, nothing lost.
      expect(await prisma.cv.findUniqueOrThrow({ where: { id: cvId } })).toEqual(before);
      expect(await prisma.cv.count()).toBeGreaterThan(0);
    } finally {
      redis.start();
    }

    await waitForApi(cookie);
    const res = await apiGet(app, `/api/cvs/${cvId}`, cookie);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(before.version);
    await worker.close();
    workers.splice(workers.indexOf(worker), 1);
  });

  it('Redis back empty: the sweeper re-enqueues queued and lost running jobs (AC-5.7a)', async () => {
    const { cookie, email } = await signUp(app);
    const queued = await createCv(app, { cookie, text: 'Acme Corp - Engineer\nShipped things.' });
    const running = await createCv(app, { cookie, text: 'Beta Ltd - Engineer\nFixed things.' });
    // The worker had picked this one up when Redis went away.
    await prisma.job.update({
      where: { id: running.jobId },
      data: { status: 'running', stage: 'generating' },
    });

    redis.cli('FLUSHALL');
    // The session went with the data: the user signs in again; their CVs are all there.
    await waitForApi(cookie, 401);
    const again = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: PASSWORD });
    expect(again.status).toBe(200);

    const worker = await startWorker();
    await worker.get(Sweeper).tick();
    for (const { jobId } of [queued, running]) {
      expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).status).toBe('completed');
    }
  });
});
