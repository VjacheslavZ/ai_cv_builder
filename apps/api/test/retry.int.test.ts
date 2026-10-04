import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, TEST_ORIGIN, uniqueQueuePrefix } from './support/app.js';
import { signUp } from './support/auth.js';
import { apiGet, createCv, waitForJob } from './support/cvs.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { startTestWorker } from './support/worker.js';
import { encryptedPdf, SAMPLE_TEXT, validPdf } from './fixtures/pdf/pdf-fixtures.js';

/** AC-5.6: "Retry" on a failed generation starts a new job on the saved source. */
describe('POST /api/cvs/:id/retry', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let worker: TestingModule;
  let llm: FakeLlmClient;
  let prisma: PrismaService;
  let user: { cookie: string; userId: string };

  beforeAll(async () => {
    db = await createTestDatabase();
    const env = { BULLMQ_PREFIX: uniqueQueuePrefix(), JOB_BACKOFF_MS: '50' };
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
    user = await signUp(app);
    llm.calls.length = 0;
  });

  function retry(cvId: string, cookie = user.cookie) {
    return request(app.getHttpServer())
      .post(`/api/cvs/${cvId}/retry`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookie);
  }

  /** A CV whose generation failed on a permanent LLM error. */
  async function failedCv(input: { text?: string; pdf?: Buffer } = { text: SAMPLE_TEXT }) {
    llm.permanent(401);
    const created = await createCv(app, { cookie: user.cookie, ...input });
    const job = await waitForJob(prisma, created.jobId, ['completed', 'failed']);
    expect(job).toMatchObject({ status: 'failed', errorCode: 'LLM_UNAVAILABLE' });
    return created;
  }

  it('turns a failed CV into a ready draft with a new job', async () => {
    const { cvId, jobId: firstJobId } = await failedCv();
    // The dashboard knows the failure is retryable.
    const list = (await apiGet(app, '/api/cvs', user.cookie)).body;
    expect(list).toEqual([
      expect.objectContaining({ id: cvId, status: 'failed', failureCode: 'LLM_UNAVAILABLE' }),
    ]);

    const res = await retry(cvId);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toEqual({ cvId, jobId: expect.any(String) });
    expect(res.body.jobId).not.toBe(firstJobId);

    const job = await waitForJob(prisma, res.body.jobId, ['completed', 'failed']);
    expect(job).toMatchObject({ status: 'completed', attempts: 1 });
    const detail = (await apiGet(app, `/api/cvs/${cvId}`, user.cookie)).body;
    expect(detail).toMatchObject({ status: 'ready', failureCode: null, failureMessage: null });
    expect(detail.document.experience.length).toBeGreaterThan(0);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]).toMatchObject({ sources: [{ kind: 'free_text' }] });
  });

  it('reuses the text extracted from the PDF, no re-upload needed', async () => {
    const { cvId } = await failedCv({ pdf: validPdf() });
    expect(await prisma.pdfUpload.count({ where: { cvId } })).toBe(0);

    const res = await retry(cvId);
    expect(res.status).toBe(202);
    expect((await waitForJob(prisma, res.body.jobId, ['completed', 'failed'])).status).toBe(
      'completed',
    );
    expect(llm.calls[1]).toMatchObject({ sources: [{ kind: 'pdf' }] });
  });

  it('reuses the PDF upload when the job failed before extraction', async () => {
    const cv = await prisma.cv.create({
      data: {
        userId: user.userId,
        title: 'Backend Engineer',
        targetRole: 'Backend Engineer',
        status: 'failed',
        failureCode: 'JOB_TIMEOUT',
        pdfUpload: { create: { bytes: new Uint8Array(validPdf()) } },
      },
    });

    const res = await retry(cv.id);
    expect(res.status).toBe(202);
    expect((await waitForJob(prisma, res.body.jobId, ['completed', 'failed'])).status).toBe(
      'completed',
    );
    expect(llm.calls[0]).toMatchObject({ sources: [{ kind: 'pdf' }] });
  });

  it('refuses when nothing of the source is left', async () => {
    const cv = await prisma.cv.create({
      data: {
        userId: user.userId,
        title: 'Backend Engineer',
        targetRole: 'Backend Engineer',
        status: 'failed',
        failureCode: 'JOB_TIMEOUT',
      },
    });
    const res = await retry(cv.id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CANNOT_RETRY' });
  });

  it('refuses a PDF failure: the file itself needs replacing', async () => {
    const { cvId, jobId } = await createCv(app, { cookie: user.cookie, pdf: encryptedPdf() });
    expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).errorCode).toBe(
      'PDF_ENCRYPTED',
    );
    const res = await retry(cvId);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CANNOT_RETRY' });
    expect(await prisma.job.count({ where: { cvId } })).toBe(1);
  });

  it('refuses a CV that is not failed', async () => {
    const { cvId, jobId } = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
    await waitForJob(prisma, jobId, ['completed']);
    const res = await retry(cvId);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CANNOT_RETRY' });
  });

  it('starts one job for two concurrent retries', async () => {
    const { cvId } = await failedCv();
    const results = await Promise.all([retry(cvId), retry(cvId)]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(await prisma.job.count({ where: { cvId } })).toBe(2);
  });

  it('is 404 for another user’s CV, and changes nothing', async () => {
    const { cvId } = await failedCv();
    const other = await signUp(app);
    const res = await retry(cvId, other.cookie);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.cv.findUniqueOrThrow({ where: { id: cvId } })).toMatchObject({
      status: 'failed',
    });
  });

  it('requires a session and the web Origin', async () => {
    const { cvId } = await failedCv();
    expect(
      (await request(app.getHttpServer()).post(`/api/cvs/${cvId}/retry`).set('Origin', TEST_ORIGIN))
        .status,
    ).toBe(401);
    expect(
      (await request(app.getHttpServer()).post(`/api/cvs/${cvId}/retry`).set('Cookie', user.cookie))
        .status,
    ).toBe(403);
  });
});
