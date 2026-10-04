import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PDF_MAX_BYTES, type CvDetailDto, type CvSummaryDto } from '@cv/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsRepository } from '../src/jobs/jobs.repository.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CvQueueService } from '../src/queue/cv-queue.service.js';
import { createTestApp, TEST_ORIGIN, uniqueQueuePrefix } from './support/app.js';
import { signUp } from './support/auth.js';
import { apiGet, createCv, postCv } from './support/cvs.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { fakePdf, SAMPLE_TEXT, validPdf } from './fixtures/pdf/pdf-fixtures.js';

// The HTTP side only: no worker runs in this file, so every job stays `queued`.
describe('CV intake and CRUD', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let queue: CvQueueService;
  let alice: { cookie: string; userId: string };

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createTestApp({
      databaseUrl: db.url,
      env: { BULLMQ_PREFIX: uniqueQueuePrefix(), MAX_ACTIVE_GENERATIONS_PER_USER: '50' },
    });
    prisma = app.get(PrismaService);
    queue = app.get(CvQueueService);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  beforeEach(async () => {
    alice = await signUp(app);
  });

  const counts = async (userId: string) => ({
    cvs: await prisma.cv.count({ where: { userId } }),
    jobs: await prisma.job.count({ where: { userId } }),
  });

  describe('POST /api/cvs', () => {
    it('writes the CV, source, upload, and queued job, enqueues, and returns 202 at once (AC-3.1, NFR-R1)', async () => {
      const started = Date.now();
      const res = await postCv(app, {
        cookie: alice.cookie,
        role: 'Backend Engineer',
        text: SAMPLE_TEXT,
        pdf: validPdf(),
      });
      expect(res.status).toBe(202);
      expect(Date.now() - started).toBeLessThan(1_000);
      const { cvId, jobId } = res.body as { cvId: string; jobId: string };

      const cv = await prisma.cv.findUniqueOrThrow({
        where: { id: cvId },
        include: { sources: true, pdfUpload: true, jobs: true },
      });
      expect(cv).toMatchObject({
        userId: alice.userId,
        title: 'Backend Engineer',
        targetRole: 'Backend Engineer',
        status: 'generating',
        document: null,
        version: 0,
      });
      expect(cv.sources).toEqual([
        expect.objectContaining({ kind: 'free_text', text: SAMPLE_TEXT }),
      ]);
      expect(Buffer.from(cv.pdfUpload!.bytes).subarray(0, 5).toString()).toBe('%PDF-');
      expect(cv.jobs).toEqual([
        expect.objectContaining({ id: jobId, type: 'generate', status: 'queued', stage: 'queued' }),
      ]);

      // Enqueued after commit with the DB id as the BullMQ jobId; nobody processed it.
      const bullJob = await queue.getJob(jobId);
      expect(bullJob?.data).toEqual({ jobId });
      expect(bullJob?.name).toBe('generate');
      expect(await bullJob?.getState()).toBe('waiting');
    });

    it('accepts text only and a PDF only', async () => {
      await createCv(app, { cookie: alice.cookie, text: 'I build APIs.' });
      await createCv(app, { cookie: alice.cookie, pdf: validPdf() });
      expect((await counts(alice.userId)).cvs).toBe(2);
    });

    it('takes the owner from the session only (AC-2.3)', async () => {
      const bob = await signUp(app);
      const { cvId } = await createCv(app, {
        cookie: alice.cookie,
        text: 'x',
        extraFields: { userId: bob.userId, ownerId: bob.userId },
      });
      expect((await prisma.cv.findUniqueOrThrow({ where: { id: cvId } })).userId).toBe(
        alice.userId,
      );
    });

    it.each([
      ['no role', { text: 'x' }, 'role'],
      ['a 101-character role', { role: 'r'.repeat(101), text: 'x' }, 'role'],
      ['neither text nor file', { role: 'Dev' }, 'text'],
      ['20,001 characters of text', { role: 'Dev', text: 't'.repeat(20_001) }, 'text'],
    ])(
      'rejects %s with 400 naming the field, and creates no job (AC-3.2, AC-3.3)',
      async (_, input, field) => {
        const res = await postCv(app, { cookie: alice.cookie, ...input });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          code: 'VALIDATION_ERROR',
          fields: { [field]: expect.any(String) },
        });
        expect(await counts(alice.userId)).toEqual({ cvs: 0, jobs: 0 });
      },
    );

    it('rejects a file over 10 MB with 413 (AC-3.3)', async () => {
      const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(PDF_MAX_BYTES)]);
      const res = await postCv(app, { cookie: alice.cookie, role: 'Dev', pdf: big });
      expect(res.status).toBe(413);
      expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
      expect(await counts(alice.userId)).toEqual({ cvs: 0, jobs: 0 });
    });

    it('rejects a fake .pdf and a wrong MIME type with 415 (AC-4.2)', async () => {
      const fake = await postCv(app, { cookie: alice.cookie, role: 'Dev', pdf: fakePdf() });
      expect(fake.status).toBe(415);
      expect(fake.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');

      const mime = await postCv(app, {
        cookie: alice.cookie,
        role: 'Dev',
        pdf: validPdf(),
        filename: 'cv.txt',
        contentType: 'text/plain',
      });
      expect(mime.status).toBe(415);
      expect(await counts(alice.userId)).toEqual({ cvs: 0, jobs: 0 });
    });

    it('requires a session (AC-1.5)', async () => {
      const anonymous = await request(app.getHttpServer())
        .post('/api/cvs')
        .set('Origin', TEST_ORIGIN)
        .field('role', 'Dev')
        .field('text', 'x');
      expect(anonymous.status).toBe(401);
    });
  });

  describe('Idempotency-Key (AC-3.4, NFR-R7)', () => {
    it('returns the same response twice and creates one CV and one job', async () => {
      const key = randomUUID();
      const first = await postCv(app, {
        cookie: alice.cookie,
        role: 'Dev',
        text: 'x',
        idempotencyKey: key,
      });
      const second = await postCv(app, {
        cookie: alice.cookie,
        role: 'Dev',
        text: 'x',
        idempotencyKey: key,
      });
      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(second.body).toEqual(first.body);
      expect(await counts(alice.userId)).toEqual({ cvs: 1, jobs: 1 });
    });

    it('holds for concurrent duplicates', async () => {
      const key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          postCv(app, { cookie: alice.cookie, role: 'Dev', text: 'x', idempotencyKey: key }),
        ),
      );
      expect(responses.map((r) => r.status)).toEqual([202, 202, 202, 202, 202]);
      expect(new Set(responses.map((r) => JSON.stringify(r.body))).size).toBe(1);
      expect(await counts(alice.userId)).toEqual({ cvs: 1, jobs: 1 });
    });

    it('is per user: the same key from another user is a new CV', async () => {
      const bob = await signUp(app);
      const key = randomUUID();
      const a = await createCv(app, { cookie: alice.cookie, text: 'x', idempotencyKey: key });
      const b = await createCv(app, { cookie: bob.cookie, text: 'x', idempotencyKey: key });
      expect(b.cvId).not.toBe(a.cvId);
    });

    it('rejects a malformed key', async () => {
      const res = await postCv(app, {
        cookie: alice.cookie,
        role: 'Dev',
        text: 'x',
        idempotencyKey: 'bad key',
      });
      expect(res.status).toBe(400);
      expect(res.body.fields).toHaveProperty('Idempotency-Key');
    });
  });

  describe('one active generation per CV (AC-5.8)', () => {
    it('answers 409 ACTIVE_JOB_EXISTS with the existing job id', async () => {
      const { cvId, jobId } = await createCv(app, { cookie: alice.cookie, text: 'x' });
      const jobs = app.get(JobsRepository);
      const attempt = prisma.$transaction((tx) =>
        jobs.createGenerateJob(tx, {
          cvId,
          userId: alice.userId,
          deadlineAt: new Date(Date.now() + 60_000),
        }),
      );
      await expect(attempt).rejects.toMatchObject({
        status: 409,
        code: 'ACTIVE_JOB_EXISTS',
        jobId,
      });
      expect(await prisma.job.count({ where: { cvId } })).toBe(1);

      // Once the first one has finished, a new generation is allowed.
      await prisma.job.update({ where: { id: jobId }, data: { status: 'failed' } });
      await prisma.$transaction((tx) =>
        jobs.createGenerateJob(tx, {
          cvId,
          userId: alice.userId,
          deadlineAt: new Date(Date.now() + 60_000),
        }),
      );
      expect(await prisma.job.count({ where: { cvId } })).toBe(2);
    });
  });

  describe('dashboard and details', () => {
    it('lists only own CVs, newest first, with the open-question count (AC-2.2, AC-12.1)', async () => {
      const bob = await signUp(app);
      const older = await createCv(app, { cookie: alice.cookie, role: 'First', text: 'x' });
      const newer = await createCv(app, { cookie: alice.cookie, role: 'Second', text: 'x' });
      await createCv(app, { cookie: bob.cookie, role: 'Bob', text: 'x' });
      await prisma.question.createMany({
        data: [
          { cvId: older.cvId, path: 'contact.email', type: 'missing', priority: 1, text: 'Email?' },
          { cvId: older.cvId, path: 'summary', type: 'vague', priority: 2, text: 'More?' },
          {
            cvId: older.cvId,
            path: 'skills',
            type: 'missing',
            priority: 3,
            text: 'Skills?',
            status: 'dismissed',
          },
        ],
      });
      await prisma.cv.update({
        where: { id: newer.cvId },
        data: { updatedAt: new Date(Date.now() + 1000) },
      });

      const res = await apiGet(app, '/api/cvs', alice.cookie);
      expect(res.status).toBe(200);
      const list = res.body as CvSummaryDto[];
      expect(list.map((cv) => cv.title)).toEqual(['Second', 'First']);
      expect(list[1]).toMatchObject({
        id: older.cvId,
        status: 'generating',
        failureCode: null,
        openQuestions: 2,
      });
      expect(list[1]!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns a CV with its active jobs; another user gets 404 (AC-2.1, AC-12.2)', async () => {
      const { cvId, jobId } = await createCv(app, { cookie: alice.cookie, text: 'x' });
      const res = await apiGet(app, `/api/cvs/${cvId}`, alice.cookie);
      expect(res.status).toBe(200);
      const cv = res.body as CvDetailDto;
      expect(cv).toMatchObject({
        id: cvId,
        status: 'generating',
        document: null,
        version: 0,
        warnings: [],
        questions: [],
        activeJobs: [{ id: jobId, status: 'queued', stage: 'queued', attempts: 0 }],
        latestJob: { id: jobId },
      });

      const bob = await signUp(app);
      const foreign = await apiGet(app, `/api/cvs/${cvId}`, bob.cookie);
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
      expect((await apiGet(app, '/api/cvs/not-a-uuid', alice.cookie)).status).toBe(404);
    });

    it('serves job status to the owner only (AC-5.4)', async () => {
      const { jobId, cvId } = await createCv(app, { cookie: alice.cookie, text: 'x' });
      const res = await apiGet(app, `/api/jobs/${jobId}`, alice.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: jobId, cvId, type: 'generate', status: 'queued' });

      const bob = await signUp(app);
      expect((await apiGet(app, `/api/jobs/${jobId}`, bob.cookie)).status).toBe(404);
      expect((await apiGet(app, `/api/jobs/${randomUUID()}`, alice.cookie)).status).toBe(404);
    });
  });

  describe('DELETE /api/cvs/:id (AC-12.3)', () => {
    it('erases the CV and everything under it, and drops the waiting queue entry', async () => {
      const { cvId, jobId } = await createCv(app, {
        cookie: alice.cookie,
        text: 'x',
        pdf: validPdf(),
      });
      await prisma.question.create({
        data: { cvId, path: 'summary', type: 'vague', priority: 1, text: 'More?' },
      });

      const bob = await signUp(app);
      const foreign = await request(app.getHttpServer())
        .delete(`/api/cvs/${cvId}`)
        .set('Origin', TEST_ORIGIN)
        .set('Cookie', bob.cookie);
      expect(foreign.status).toBe(404);

      const res = await request(app.getHttpServer())
        .delete(`/api/cvs/${cvId}`)
        .set('Origin', TEST_ORIGIN)
        .set('Cookie', alice.cookie);
      expect(res.status).toBe(204);

      expect(await prisma.cv.count({ where: { id: cvId } })).toBe(0);
      expect(await prisma.sourceText.count({ where: { cvId } })).toBe(0);
      expect(await prisma.pdfUpload.count({ where: { cvId } })).toBe(0);
      expect(await prisma.job.count({ where: { cvId } })).toBe(0);
      expect(await prisma.question.count({ where: { cvId } })).toBe(0);
      expect(await queue.getJob(jobId)).toBeUndefined();

      expect((await apiGet(app, `/api/cvs/${cvId}`, alice.cookie)).status).toBe(404);
      const again = await request(app.getHttpServer())
        .delete(`/api/cvs/${cvId}`)
        .set('Origin', TEST_ORIGIN)
        .set('Cookie', alice.cookie);
      expect(again.status).toBe(404);
    });
  });
});

describe('generation limits (NFR-S9)', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createTestApp({
      databaseUrl: db.url,
      env: {
        BULLMQ_PREFIX: uniqueQueuePrefix(),
        MAX_ACTIVE_GENERATIONS_PER_USER: '2',
        GENERATIONS_PER_HOUR: '3',
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('allows 2 active generations per user, then 429', async () => {
    const { cookie, userId } = await signUp(app);
    const first = await createCv(app, { cookie, text: 'x' });
    await createCv(app, { cookie, text: 'x' });
    const third = await postCv(app, { cookie, role: 'Dev', text: 'x' });
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('RATE_LIMITED');

    const prisma = app.get(PrismaService);
    expect(await prisma.cv.count({ where: { userId } })).toBe(2);

    // A finished job frees its slot.
    await prisma.job.update({ where: { id: first.jobId }, data: { status: 'completed' } });
    await createCv(app, { cookie, text: 'x' });
  });

  it('allows N generations per hour, then 429', async () => {
    const { cookie, userId } = await signUp(app);
    const prisma = app.get(PrismaService);
    for (let i = 0; i < 3; i++) {
      const { jobId } = await createCv(app, { cookie, text: 'x' });
      await prisma.job.update({ where: { id: jobId }, data: { status: 'completed' } });
    }
    const res = await postCv(app, { cookie, role: 'Dev', text: 'x' });
    expect(res.status).toBe(429);
    expect(await prisma.cv.count({ where: { userId } })).toBe(3);
  });

  it('counts concurrent creates against the active limit', async () => {
    const { cookie, userId } = await signUp(app);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => postCv(app, { cookie, role: 'Dev', text: 'x' })),
    );
    expect(responses.filter((r) => r.status === 202)).toHaveLength(2);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(2);
    expect(await app.get(PrismaService).job.count({ where: { userId } })).toBe(2);
  });
});
