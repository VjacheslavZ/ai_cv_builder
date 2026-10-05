import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, TEST_ORIGIN, uniqueQueuePrefix } from './support/app.js';
import { signUp } from './support/auth.js';
import { apiGet } from './support/cvs.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { getDetail, patchCv, readyCv } from './support/ready-cv.js';
import { startTestWorker } from './support/worker.js';

/** AC-12.4: the title of a CV, 1–100 characters, separate from the versioned document. */
describe('PATCH /api/cvs/:id/title', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let worker: TestingModule;
  let llm: FakeLlmClient;
  let prisma: PrismaService;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const env = { BULLMQ_PREFIX: uniqueQueuePrefix() };
    app = await createTestApp({ databaseUrl: db.url, env });
    llm = new FakeLlmClient();
    worker = await startTestWorker({ databaseUrl: db.url, env, llm });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    await db?.drop();
  });

  beforeEach(async () => {
    ({ cookie, userId } = await signUp(app));
  });

  function rename(cvId: string, body: unknown, as = cookie) {
    return request(app.getHttpServer())
      .patch(`/api/cvs/${cvId}/title`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', as)
      .send(body as object);
  }

  it('saves the trimmed title without touching the document version', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const before = await getDetail(app, cv.cvId, cookie);

    const res = await rename(cv.cvId, { title: '  Staff Engineer – fintech  ' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ title: 'Staff Engineer – fintech', updatedAt: expect.any(String) });

    const after = await getDetail(app, cv.cvId, cookie);
    expect(after).toMatchObject({
      title: 'Staff Engineer – fintech',
      targetRole: before.targetRole,
      version: before.version,
      document: before.document,
    });
    // An editor open on the old version keeps saving without a conflict.
    const patched = await patchCv(app, cv.cvId, cookie, {
      baseVersion: before.version,
      ops: [{ op: 'set', path: 'summary', value: 'Edited after the rename' }],
    });
    expect(patched.status).toBe(200);
    const list = (await apiGet(app, '/api/cvs', cookie)).body;
    expect(list).toEqual([
      expect.objectContaining({ id: cv.cvId, title: 'Staff Engineer – fintech' }),
    ]);
  });

  it('works while the CV is still generating', async () => {
    const cv = await prisma.cv.create({
      data: { userId, title: 'Backend Engineer', targetRole: 'Backend Engineer' },
    });
    expect(cv.status).toBe('generating');
    expect((await rename(cv.id, { title: 'Platform Engineer' })).status).toBe(200);
    expect(await prisma.cv.findUniqueOrThrow({ where: { id: cv.id } })).toMatchObject({
      title: 'Platform Engineer',
      status: 'generating',
    });
  });

  it.each([
    ['empty', { title: '' }],
    ['blank', { title: '   ' }],
    ['too long', { title: 'x'.repeat(101) }],
    ['missing', {}],
    ['not a string', { title: 42 }],
  ])('rejects a %s title with 400 and changes nothing', async (_, body) => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const res = await rename(cv.cvId, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { title: expect.any(String) },
    });
    expect((await getDetail(app, cv.cvId, cookie)).title).toBe('Engineer');
  });

  it('accepts exactly 100 characters', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    expect((await rename(cv.cvId, { title: 'x'.repeat(100) })).status).toBe(200);
  });

  it('is 404 for an unknown CV', async () => {
    const res = await rename('00000000-0000-4000-8000-000000000000', { title: 'Anything' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('requires a session and the web Origin', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const path = `/api/cvs/${cv.cvId}/title`;
    const body = { title: 'New title' };
    expect(
      (await request(app.getHttpServer()).patch(path).set('Origin', TEST_ORIGIN).send(body)).status,
    ).toBe(401);
    expect(
      (await request(app.getHttpServer()).patch(path).set('Cookie', cookie).send(body)).status,
    ).toBe(403);
  });
});
