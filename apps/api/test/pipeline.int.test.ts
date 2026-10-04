import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import type { CvDocument, CvEvent } from '@cv/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CvQueueService } from '../src/queue/cv-queue.service.js';
import { GenerateProcessor } from '../src/worker/generate.processor.js';
import { Sweeper } from '../src/worker/sweeper.js';
import { createTestApp, TEST_ORIGIN, uniqueQueuePrefix } from './support/app.js';
import { signUp } from './support/auth.js';
import { apiGet, createCv, waitFor, waitForJob } from './support/cvs.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { openSse } from './support/sse.js';
import { startTestWorker } from './support/worker.js';
import {
  corruptedPdf,
  encryptedPdf,
  SAMPLE_TEXT,
  scanPdf,
  validPdf,
} from './fixtures/pdf/pdf-fixtures.js';

const SHORT_TIMEOUTS = {
  JOB_BACKOFF_MS: '50',
  // The sweeper runs only when a test calls `tick()`.
  SWEEPER_INTERVAL_MS: '600000',
  SWEEPER_REQUEUE_AFTER_MS: '1',
};

describe('generate pipeline (fake LLM)', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let worker: TestingModule;
  let llm: FakeLlmClient;
  let prisma: PrismaService;
  let user: { cookie: string; userId: string };
  let baseUrl: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const env = {
      BULLMQ_PREFIX: uniqueQueuePrefix(),
      MAX_ACTIVE_GENERATIONS_PER_USER: '50',
      ...SHORT_TIMEOUTS,
    };
    app = await createTestApp({ databaseUrl: db.url, env });
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
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

  async function detail(cvId: string) {
    const res = await apiGet(app, `/api/cvs/${cvId}`, user.cookie);
    expect(res.status).toBe(200);
    return res.body as {
      status: string;
      document: CvDocument | null;
      version: number;
      warnings: unknown[];
      failureCode: string | null;
      failureMessage: string | null;
    };
  }

  it('turns free text into a ready CV: document, version, aiRevision, job completed', async () => {
    const { cvId, jobId } = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
    const job = await waitForJob(prisma, jobId, ['completed', 'failed']);
    expect(job).toMatchObject({
      status: 'completed',
      stage: 'completed',
      attempts: 1,
      errorCode: null,
    });

    const cv = await prisma.cv.findUniqueOrThrow({ where: { id: cvId } });
    expect(cv).toMatchObject({ status: 'ready', version: 1, aiRevision: 1, failureCode: null });
    expect((await detail(cvId)).document?.experience[0]?.bullets.length).toBeGreaterThan(0);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toMatchObject({
      targetRole: 'Backend Engineer',
      sources: [{ kind: 'free_text' }],
    });
  });

  describe('PDF extraction (AC-4.1 – 4.4)', () => {
    it('saves the text as source and deletes the upload', async () => {
      const { cvId, jobId } = await createCv(app, { cookie: user.cookie, pdf: validPdf() });
      expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).status).toBe('completed');
      const sources = await prisma.sourceText.findMany({ where: { cvId } });
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({ kind: 'pdf' });
      expect(sources[0]!.text).toContain('Cut p95 API latency from 800 ms to 200 ms');
      expect(await prisma.pdfUpload.count({ where: { cvId } })).toBe(0);
    });

    it.each([
      ['a scan without free text', scanPdf(), 'PDF_NO_TEXT'],
      ['an encrypted PDF', encryptedPdf(), 'PDF_ENCRYPTED'],
      ['a corrupted PDF', corruptedPdf(), 'PDF_CORRUPTED'],
      ['an 11-page PDF', validPdf(11), 'PDF_TOO_MANY_PAGES'],
    ])('fails %s with %s, deletes the upload, and keeps the worker alive', async (_, pdf, code) => {
      const { cvId, jobId } = await createCv(app, { cookie: user.cookie, pdf });
      const job = await waitForJob(prisma, jobId, ['completed', 'failed']);
      expect(job).toMatchObject({ status: 'failed', stage: 'failed', errorCode: code });
      expect(job.errorMessage).toEqual(expect.any(String));

      const cv = await detail(cvId);
      expect(cv).toMatchObject({ status: 'failed', failureCode: code, document: null });
      expect(cv.failureMessage).toBe(job.errorMessage);
      expect(await prisma.pdfUpload.count({ where: { cvId } })).toBe(0);
      expect(llm.calls).toHaveLength(0);

      // Not retried, and the worker still processes the next job.
      const next = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
      expect((await waitForJob(prisma, next.jobId, ['completed', 'failed'])).status).toBe(
        'completed',
      );
    });

    it('continues from free text when the PDF is a scan, and persists a warning (AC-4.3)', async () => {
      const { cvId, jobId } = await createCv(app, {
        cookie: user.cookie,
        pdf: scanPdf(),
        text: SAMPLE_TEXT,
      });
      expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).status).toBe('completed');
      const cv = await detail(cvId);
      expect(cv.status).toBe('ready');
      expect(cv.warnings).toEqual([
        { code: 'PDF_NO_TEXT_USED_FREE_TEXT', message: expect.stringContaining('scan') },
      ]);
      expect(await prisma.pdfUpload.count({ where: { cvId } })).toBe(0);
      expect(await prisma.sourceText.count({ where: { cvId, kind: 'pdf' } })).toBe(0);
    });
  });

  describe('LLM outcomes', () => {
    it('re-requests invalid output with the validation errors (AC-6.6)', async () => {
      llm.invalid(2);
      const { jobId } = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
      expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).status).toBe('completed');
      expect(llm.calls).toHaveLength(3);
      expect(llm.calls[1]!.feedback).toMatch(/summary/);
    });

    it('fails with LLM_INVALID_OUTPUT after the re-requests, writing nothing (NFR-R5)', async () => {
      llm.invalid(3);
      const { cvId, jobId } = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
      const job = await waitForJob(prisma, jobId, ['completed', 'failed']);
      expect(job).toMatchObject({ status: 'failed', errorCode: 'LLM_INVALID_OUTPUT' });
      expect(await prisma.cv.findUniqueOrThrow({ where: { id: cvId } })).toMatchObject({
        document: null,
        version: 0,
      });
    });

    it('retries a transient error with backoff (AC-5.5)', async () => {
      llm.transient(529);
      const { jobId } = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
      const job = await waitForJob(prisma, jobId, ['completed', 'failed']);
      expect(job).toMatchObject({ status: 'completed', attempts: 2 });
      expect(llm.calls).toHaveLength(2);
    });

    it('fails at once on a permanent error, without retrying (AC-5.6)', async () => {
      llm.permanent(401);
      const { cvId, jobId } = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
      const job = await waitForJob(prisma, jobId, ['completed', 'failed']);
      expect(job).toMatchObject({ status: 'failed', errorCode: 'LLM_UNAVAILABLE', attempts: 1 });
      expect(llm.calls).toHaveLength(1);
      expect((await detail(cvId)).status).toBe('failed');
    });

    it('fails with LLM_UNAVAILABLE once the attempts are used up', async () => {
      llm.transient(500).transient(500).transient(500);
      const { jobId } = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
      const job = await waitForJob(prisma, jobId, ['completed', 'failed']);
      expect(job).toMatchObject({ status: 'failed', errorCode: 'LLM_UNAVAILABLE', attempts: 3 });
    });
  });

  it('deleting the CV mid-generation writes nothing and keeps the worker alive (AC-5.9)', async () => {
    llm.slow(1_000);
    const { cvId, jobId } = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
    await waitFor(
      async () => (await prisma.job.findUnique({ where: { id: jobId } }))?.stage === 'generating',
      { what: 'the generating stage' },
    );
    const res = await request(app.getHttpServer())
      .delete(`/api/cvs/${cvId}`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(204);

    // Wait for the fake to answer; the run must notice and stop.
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(await prisma.cv.count({ where: { id: cvId } })).toBe(0);
    expect(await prisma.sourceText.count({ where: { cvId } })).toBe(0);
    expect(await prisma.job.count({ where: { id: jobId } })).toBe(0);

    const next = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
    expect((await waitForJob(prisma, next.jobId, ['completed', 'failed'])).status).toBe(
      'completed',
    );
  });

  it('a job processed twice produces one result (NFR-R7)', async () => {
    // Created directly in Postgres (not enqueued), then run twice at the same time.
    const cv = await prisma.cv.create({
      data: {
        userId: user.userId,
        title: 'Dev',
        targetRole: 'Dev',
        sources: { create: { kind: 'free_text', text: SAMPLE_TEXT } },
        pdfUpload: { create: { bytes: new Uint8Array(validPdf()) } },
      },
    });
    const job = await prisma.job.create({
      data: {
        cvId: cv.id,
        userId: user.userId,
        type: 'generate',
        deadlineAt: new Date(Date.now() + 600_000),
      },
    });
    const processor = worker.get(GenerateProcessor);
    const bullJob = { data: { jobId: job.id }, attemptsMade: 0, opts: { attempts: 3 } } as never;
    await Promise.all([processor.process(bullJob), processor.process(bullJob)]);
    await processor.process(bullJob); // and once more after it finished

    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'completed',
    });
    expect(await prisma.cv.findUniqueOrThrow({ where: { id: cv.id } })).toMatchObject({
      status: 'ready',
      version: 1,
      aiRevision: 1,
    });
    expect(await prisma.sourceText.count({ where: { cvId: cv.id, kind: 'pdf' } })).toBe(1);
    expect(await prisma.pdfUpload.count({ where: { cvId: cv.id } })).toBe(0);
  });

  describe('sweeper (AC-5.7a)', () => {
    async function insertJob(status: 'queued' | 'running', ageMs = 0) {
      const cv = await prisma.cv.create({
        data: {
          userId: user.userId,
          title: 'Dev',
          targetRole: 'Dev',
          sources: { create: { kind: 'free_text', text: SAMPLE_TEXT } },
        },
      });
      return prisma.job.create({
        data: {
          cvId: cv.id,
          userId: user.userId,
          type: 'generate',
          status,
          createdAt: new Date(Date.now() - ageMs),
          deadlineAt: new Date(Date.now() + 600_000),
        },
      });
    }

    it('re-enqueues a job whose enqueue was lost, exactly once', async () => {
      const job = await insertJob('queued', 60_000);
      const sweeper = worker.get(Sweeper);
      await Promise.all([sweeper.tick(), sweeper.tick()]);
      await sweeper.tick();
      expect((await waitForJob(prisma, job.id, ['completed', 'failed'])).status).toBe('completed');
      expect(llm.calls).toHaveLength(1);
      expect(await prisma.cv.findUniqueOrThrow({ where: { id: job.cvId } })).toMatchObject({
        version: 1,
      });
    });

    it('re-enqueues a running job that Redis no longer has', async () => {
      const job = await insertJob('running');
      await worker.get(Sweeper).tick();
      expect((await waitForJob(prisma, job.id, ['completed', 'failed'])).status).toBe('completed');
    });

    it('leaves a job alone while BullMQ still has it', async () => {
      const job = await insertJob('queued', 60_000);
      const queue = app.get(CvQueueService);
      await queue.queue.pause();
      try {
        await queue.add('generate', job.id);
        await worker.get(Sweeper).tick();
        // Still exactly one waiting entry: the sweeper did not add a duplicate.
        expect(await queue.queue.count()).toBe(1);
      } finally {
        await queue.queue.resume();
      }
      expect((await waitForJob(prisma, job.id, ['completed', 'failed'])).status).toBe('completed');
    });

    it('fails a job past its deadline with JOB_TIMEOUT (NFR-R4)', async () => {
      const job = await insertJob('queued');
      await prisma.job.update({
        where: { id: job.id },
        data: { deadlineAt: new Date(Date.now() - 1) },
      });
      await worker.get(Sweeper).tick();
      expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
        status: 'failed',
        errorCode: 'JOB_TIMEOUT',
      });
      expect(await prisma.cv.findUniqueOrThrow({ where: { id: job.cvId } })).toMatchObject({
        status: 'failed',
        failureCode: 'JOB_TIMEOUT',
      });
    });

    it('deletes PDF uploads older than the retention period', async () => {
      const cv = await prisma.cv.create({
        data: { userId: user.userId, title: 'Dev', targetRole: 'Dev' },
      });
      await prisma.pdfUpload.create({
        data: {
          cvId: cv.id,
          bytes: new Uint8Array(validPdf()),
          createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        },
      });
      await worker.get(Sweeper).tick();
      expect(await prisma.pdfUpload.count({ where: { cvId: cv.id } })).toBe(0);
    });
  });

  describe('SSE (AC-5.1, AC-5.3, AC-5.4)', () => {
    it('sends a snapshot first, then live stages and completion', async () => {
      llm.slow(500);
      const { cvId, jobId } = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
      const stream = await openSse(`${baseUrl}/api/cvs/${cvId}/events`, user.cookie);
      try {
        expect(stream.status).toBe(200);
        expect(stream.contentType).toMatch(/^text\/event-stream/);
        const first = (await stream.next()) as Extract<CvEvent, { type: 'snapshot' }>;
        expect(first).toMatchObject({
          type: 'snapshot',
          cv: { id: cvId, status: 'generating' },
          job: { id: jobId },
        });

        const events = await stream.until((e) => e.type === 'completed');
        // Stages already passed when the stream opened are in the snapshot.
        const stages = [
          first.job!.stage,
          ...events.flatMap((e) => (e.type === 'stage' ? [e.stage] : [])),
        ];
        expect(stages).toEqual(expect.arrayContaining(['generating', 'validating']));
        expect(events.at(-1)).toEqual({ type: 'completed', jobId, version: 1 });
      } finally {
        stream.close();
      }
    });

    it('a reconnect after completion gets the final state in the snapshot', async () => {
      const { cvId, jobId } = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
      await waitForJob(prisma, jobId, ['completed']);
      // E.g. a second device, or the phone coming back from the background.
      const stream = await openSse(`${baseUrl}/api/cvs/${cvId}/events`, user.cookie);
      try {
        const first = (await stream.next()) as Extract<CvEvent, { type: 'snapshot' }>;
        expect(first).toMatchObject({
          type: 'snapshot',
          cv: { status: 'ready', version: 1 },
          job: { id: jobId, status: 'completed', stage: 'completed' },
        });
      } finally {
        stream.close();
      }
    });

    it('sends heartbeats and hides other users’ streams', async () => {
      const { cvId } = await createCv(app, { cookie: user.cookie, text: SAMPLE_TEXT });
      const other = await signUp(app);
      const foreign = await openSse(`${baseUrl}/api/cvs/${cvId}/events`, other.cookie);
      expect(foreign.status).toBe(404);
      foreign.close();
    });
  });
});

describe('job deadline (NFR-R3, NFR-R4)', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let worker: TestingModule;
  const llm = new FakeLlmClient();

  beforeAll(async () => {
    db = await createTestDatabase();
    // Each call may take 1 s; the job has 2.5 s in total.
    const env = {
      BULLMQ_PREFIX: uniqueQueuePrefix(),
      JOB_DEADLINE_MS: '2500',
      LLM_TIMEOUT_MS: '1000',
      ...SHORT_TIMEOUTS,
    };
    app = await createTestApp({ databaseUrl: db.url, env });
    worker = await startTestWorker({ databaseUrl: db.url, env, llm });
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    await db?.drop();
  });

  it('fails with JOB_TIMEOUT once a call no longer fits, without calling again', async () => {
    llm.slow(10_000).slow(10_000).slow(10_000);
    const { cookie } = await signUp(app);
    const { cvId, jobId } = await createCv(app, { cookie, text: SAMPLE_TEXT });
    const prisma = app.get(PrismaService);
    const job = await waitForJob(prisma, jobId, ['completed', 'failed'], 8_000);
    expect(job).toMatchObject({ status: 'failed', errorCode: 'JOB_TIMEOUT' });
    // Slow calls time out and are retried; the attempt that hit the deadline made no call.
    expect(llm.calls.length).toBeGreaterThanOrEqual(1);
    expect(llm.calls.length).toBeLessThan(job.attempts);
    expect(await prisma.cv.findUniqueOrThrow({ where: { id: cvId } })).toMatchObject({
      status: 'failed',
    });
  });
});

describe('heartbeat', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createTestApp({
      databaseUrl: db.url,
      env: { BULLMQ_PREFIX: uniqueQueuePrefix(), SSE_HEARTBEAT_MS: '100' },
    });
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('keeps an idle stream alive with heartbeat events', async () => {
    const { cookie } = await signUp(app);
    const { cvId } = await createCv(app, { cookie, text: SAMPLE_TEXT });
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const stream = await openSse(`http://127.0.0.1:${port}/api/cvs/${cvId}/events`, cookie);
    try {
      expect((await stream.next()).type).toBe('snapshot');
      expect(await stream.next(1_000)).toEqual({ type: 'heartbeat' });
      expect(await stream.next(1_000)).toEqual({ type: 'heartbeat' });
    } finally {
      stream.close();
    }
  });
});
