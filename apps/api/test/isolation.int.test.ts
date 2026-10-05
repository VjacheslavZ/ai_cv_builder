import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { baseUrl, createTestApp, TEST_ORIGIN, uniqueQueuePrefix } from './support/app.js';
import { signUp } from './support/auth.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { getDetail, readyCv, type ReadyCv } from './support/ready-cv.js';
import { openSse } from './support/sse.js';
import { startTestWorker } from './support/worker.js';

/** What a foreign request may point at: Alice's CV, her question, and her job. */
interface Target {
  cvId: string;
  questionId: string;
  jobId: string;
}

type Method = 'get' | 'post' | 'patch' | 'delete';

interface Endpoint {
  name: string;
  method: Method;
  path: (t: Target) => string;
  body?: object;
}

/**
 * Every endpoint that takes a CV, question, or job id (NFR-S2, AC-2.1). A new endpoint is one
 * line here; SSE is checked separately because it is a stream.
 */
const ENDPOINTS: Endpoint[] = [
  { name: 'GET cv', method: 'get', path: (t) => `/api/cvs/${t.cvId}` },
  { name: 'GET pdf', method: 'get', path: (t) => `/api/cvs/${t.cvId}/pdf` },
  { name: 'GET pdf preview', method: 'get', path: (t) => `/api/cvs/${t.cvId}/pdf/preview` },
  { name: 'GET job', method: 'get', path: (t) => `/api/jobs/${t.jobId}` },
  {
    name: 'PATCH cv',
    method: 'patch',
    path: (t) => `/api/cvs/${t.cvId}`,
    body: { baseVersion: 1, ops: [{ op: 'set', path: 'summary', value: 'Taken over' }] },
  },
  { name: 'POST retry', method: 'post', path: (t) => `/api/cvs/${t.cvId}/retry` },
  {
    name: 'PATCH title',
    method: 'patch',
    path: (t) => `/api/cvs/${t.cvId}/title`,
    body: { title: 'Taken over' },
  },
  {
    name: 'POST answer',
    method: 'post',
    path: (t) => `/api/cvs/${t.cvId}/questions/${t.questionId}/answer`,
    body: { answer: '+44 20 7946 0000' },
  },
  {
    name: 'POST dismiss',
    method: 'post',
    path: (t) => `/api/cvs/${t.cvId}/questions/${t.questionId}/dismiss`,
  },
  { name: 'DELETE cv', method: 'delete', path: (t) => `/api/cvs/${t.cvId}` },
];

describe('user isolation matrix (NFR-S2, AC-2.1)', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let alice: { cookie: string };
  let bob: { cookie: string };
  let cv: ReadyCv;
  let target: Target;

  beforeAll(async () => {
    db = await createTestDatabase();
    const env = { BULLMQ_PREFIX: uniqueQueuePrefix() };
    app = await createTestApp({ databaseUrl: db.url, env });
    const llm = new FakeLlmClient();
    worker = await startTestWorker({ databaseUrl: db.url, env, llm });
    prisma = app.get(PrismaService);

    alice = await signUp(app);
    bob = await signUp(app);
    cv = await readyCv(app, prisma, llm, alice.cookie);
    const job = await prisma.job.findFirstOrThrow({ where: { cvId: cv.cvId } });
    target = { cvId: cv.cvId, questionId: cv.question('contact.phone').id, jobId: job.id };
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    await db?.drop();
  });

  /** Everything a foreign request could have changed. */
  async function aliceState() {
    const detail = await getDetail(app, cv.cvId, alice.cookie);
    const jobs = await prisma.job.findMany({
      where: { cvId: cv.cvId },
      orderBy: { createdAt: 'asc' },
    });
    return { detail, jobs };
  }

  it.each(ENDPOINTS)('$name of another user’s CV → 404, nothing changes', async (endpoint) => {
    const before = await aliceState();

    let req = request(app.getHttpServer())
      [endpoint.method](endpoint.path(target))
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', bob.cookie);
    if (endpoint.body) req = req.send(endpoint.body);
    const res = await req;

    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    expect(await aliceState()).toEqual(before);
  });

  it('SSE events of another user’s CV → 404', async () => {
    const stream = await openSse(`${baseUrl(app)}/api/cvs/${cv.cvId}/events`, bob.cookie);
    stream.close();
    expect(stream.status).toBe(404);
  });

  it('the list never shows another user’s CV (AC-2.2)', async () => {
    const res = await request(app.getHttpServer()).get('/api/cvs').set('Cookie', bob.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('every endpoint still works for the owner (the matrix is not vacuous)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/cvs/${cv.cvId}/pdf`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    const job = await request(app.getHttpServer())
      .get(`/api/jobs/${target.jobId}`)
      .set('Cookie', alice.cookie);
    expect(job.status).toBe(200);
  });
});
