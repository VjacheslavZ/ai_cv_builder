import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import type { LlmCvOutput } from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, uniqueQueuePrefix } from './support/app.js';
import { signUp } from './support/auth.js';
import { waitFor, waitForJob } from './support/cvs.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { answerQuestion, getDetail, patchCv, readyCv, type ReadyCv } from './support/ready-cv.js';
import { startTestWorker } from './support/worker.js';

// `apply_answer` jobs (FR-9): the AI rewrites one part, manual edits always survive (AC-9.3),
// jobs on one CV run in order (AC-9.7), and the commit is fenced by `aiRevision` (NFR-R6).

describe('apply_answer', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let worker: TestingModule;
  let llm: FakeLlmClient;
  let prisma: PrismaService;
  let cookie: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const env = {
      BULLMQ_PREFIX: uniqueQueuePrefix(),
      MAX_ACTIVE_GENERATIONS_PER_USER: '50',
      JOB_BACKOFF_MS: '50',
      CV_LOCK_RETRY_MS: '50',
      WORKER_CONCURRENCY: '4',
    };
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
    ({ cookie } = await signUp(app));
    llm.calls.length = 0;
    llm.sectionCalls.length = 0;
  });

  const bulletsPath = (cv: ReadyCv) => `experience.${cv.entryId}.bullets`;

  /** Answers the vague bullets question and waits for the job. */
  async function apply(cv: ReadyCv, answer: string, questionId = cv.question(bulletsPath(cv)).id) {
    const res = await answerQuestion(app, cv.cvId, questionId, cookie, answer);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toEqual({ status: 'applying', jobId: expect.any(String) });
    return res.body.jobId as string;
  }

  /** A rewrite of the Acme entry with exactly these bullets (ids from the CV). */
  function rewrite(cv: ReadyCv, bullets: { id?: string; text: string; evidence: string[] }[]) {
    const out: LlmCvOutput = {
      contact: { name: null, email: null, phone: null, city: null, links: [] },
      summary: '',
      experience: [
        {
          id: cv.entryId,
          company: 'Acme Corp',
          title: 'Software engineer',
          start: '2020-01',
          end: 'present',
          evidence: ['Acme Corp - Software engineer, Jan 2020 - present'],
          bullets,
        },
      ],
      education: [],
      skills: [],
      questions: [],
    };
    return out;
  }

  it('rewrites only the entry, keeps the answer as a source, answers the question (AC-9.1)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const before = await prisma.cv.findUniqueOrThrow({ where: { id: cv.cvId } });
    const jobId = await apply(cv, 'Shipped a billing service used by 40 clients.');
    expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).status).toBe('completed');

    const detail = await getDetail(app, cv.cvId, cookie);
    const entry = detail.document!.experience[0]!;
    expect(entry.id).toBe(cv.entryId);
    expect(entry.bullets.map((b) => b.text)).toEqual([
      ...cv.doc.experience[0]!.bullets.map((b) => b.text),
      'Shipped a billing service used by 40 clients.',
    ]);
    expect(entry.bullets.slice(0, 2).map((b) => b.id)).toEqual(cv.bulletIds);
    // Everything else is as it was.
    expect(detail.document!.summary).toBe(cv.doc.summary);
    expect(detail.document!.skills).toEqual(cv.doc.skills);
    expect(detail.questions.find((q) => q.path === bulletsPath(cv))?.status).toBe('answered');

    const after = await prisma.cv.findUniqueOrThrow({ where: { id: cv.cvId } });
    expect(after.version).toBe(before.version + 1);
    expect(after.aiRevision).toBe(before.aiRevision + 1);
    const snapshot = await prisma.aiSnapshot.findUniqueOrThrow({ where: { cvId: cv.cvId } });
    expect(snapshot).toMatchObject({
      path: `experience.${cv.entryId}`,
      aiRevision: before.aiRevision,
    });
    expect(llm.sectionCalls[0]).toMatchObject({ scope: `experience.${cv.entryId}` });
    expect(llm.sectionCalls[0]!.sources.at(-1)).toMatchObject({ kind: 'answer' });
  });

  it('restores a manually edited bullet the model dropped or moved (AC-9.3)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const edited = `experience.${cv.entryId}.bullets.${cv.bulletIds[1]}`;
    const patched = await patchCv(app, cv.cvId, cookie, {
      baseVersion: cv.version,
      ops: [{ op: 'set', path: edited, value: 'Led a team of 5 engineers' }],
    });
    expect(patched.status).toBe(200);
    // The model drops the edited bullet and puts a new one first.
    llm.valid(
      rewrite(cv, [
        { text: 'Mentored 3 junior engineers', evidence: ['Mentored 3 junior engineers.'] },
        {
          id: cv.bulletIds[0],
          text: 'Cut API latency from 800 ms to 200 ms by adding Redis caching',
          evidence: ['Cut API latency from 800 ms to 200 ms by adding Redis caching.'],
        },
      ]),
    );
    const q = await prisma.question.create({
      data: { cvId: cv.cvId, path: bulletsPath(cv), type: 'vague', priority: 22, text: 'More?' },
    });
    const jobId = await apply(cv, 'I mentored juniors.', q.id);
    expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).status).toBe('completed');

    const bullets = (await getDetail(app, cv.cvId, cookie)).document!.experience[0]!.bullets;
    expect(bullets[1]).toEqual({ id: cv.bulletIds[1], text: 'Led a team of 5 engineers' });
  });

  it('a manual PATCH during the apply survives, and does not make it retry (NFR-R6)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    llm.slow(600);
    const jobId = await apply(cv, 'Shipped billing.');
    await waitFor(async () => llm.sectionCalls.length > 0, { what: 'the rewrite to start' });
    const edited = `experience.${cv.entryId}.bullets.${cv.bulletIds[0]}`;
    const patched = await patchCv(app, cv.cvId, cookie, {
      baseVersion: cv.version,
      ops: [{ op: 'set', path: edited, value: 'Typed while the AI worked' }],
    });
    expect(patched.status).toBe(200);

    const job = await waitForJob(prisma, jobId, ['completed', 'failed']);
    expect(job).toMatchObject({ status: 'completed', attempts: 1 });
    expect(llm.sectionCalls).toHaveLength(1);
    const doc = (await getDetail(app, cv.cvId, cookie)).document!;
    expect(doc.experience[0]!.bullets[0]!.text).toBe('Typed while the AI worked');
    expect(doc.experience[0]!.bullets.at(-1)!.text).toBe('Shipped billing.');
  });

  it('applies two quick answers on one entry in order, both reflected (AC-9.7)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const second = await prisma.question.create({
      data: { cvId: cv.cvId, path: bulletsPath(cv), type: 'vague', priority: 22, text: 'And?' },
    });
    llm.slow(300);
    const first = await apply(cv, 'Shipped billing.');
    const next = await apply(cv, 'Ran on-call for 2 years.', second.id);
    for (const id of [first, next]) {
      // Attempt 1 each: the second waited for the lock instead of losing a fenced commit.
      expect(await waitForJob(prisma, id, ['completed', 'failed'])).toMatchObject({
        status: 'completed',
        attempts: 1,
      });
    }
    const texts = (await getDetail(app, cv.cvId, cookie)).document!.experience[0]!.bullets.map(
      (b) => b.text,
    );
    expect(texts).toEqual(expect.arrayContaining(['Shipped billing.', 'Ran on-call for 2 years.']));
    // The second rewrite was given the first one's result.
    const lastCall = llm.sectionCalls.at(-1)!;
    expect(JSON.stringify(lastCall.section)).toMatch(/Shipped billing\./);
  });

  it('a newer AI write while the job ran: the result is discarded and the job re-runs', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    llm.slow(400);
    const jobId = await apply(cv, 'Shipped billing.');
    await waitFor(async () => llm.sectionCalls.length > 0, { what: 'the rewrite to start' });
    // Another AI write committed meanwhile (as after an expired lock).
    await prisma.cv.update({ where: { id: cv.cvId }, data: { aiRevision: { increment: 1 } } });

    const job = await waitForJob(prisma, jobId, ['completed', 'failed']);
    expect(job).toMatchObject({ status: 'completed', attempts: 2 });
    expect(llm.sectionCalls).toHaveLength(2);
    const bullets = (await getDetail(app, cv.cvId, cookie)).document!.experience[0]!.bullets;
    expect(bullets.filter((b) => b.text === 'Shipped billing.')).toHaveLength(1);
  });

  it('a manually written fact backs a later rewrite (AC-10.3)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const edited = `experience.${cv.entryId}.bullets.${cv.bulletIds[1]}`;
    await patchCv(app, cv.cvId, cookie, {
      baseVersion: cv.version,
      ops: [{ op: 'set', path: edited, value: 'Led a team of 5 engineers' }],
    });
    llm.valid(
      rewrite(cv, [
        { id: cv.bulletIds[0], text: 'Cut API latency', evidence: ['Cut API latency'] },
        { id: cv.bulletIds[1], text: 'Led a team of 5 engineers', evidence: ['x'] },
        {
          text: 'Led a team of 5 engineers through the billing launch',
          evidence: ['Led a team of 5 engineers', 'billing launch'],
        },
      ]),
    );
    const q = await prisma.question.create({
      data: { cvId: cv.cvId, path: bulletsPath(cv), type: 'vague', priority: 22, text: 'More?' },
    });
    const jobId = await apply(cv, 'We did the billing launch in 2022.', q.id);
    expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).status).toBe('completed');
    const texts = (await getDetail(app, cv.cvId, cookie)).document!.experience[0]!.bullets.map(
      (b) => b.text,
    );
    expect(texts).toContain('Led a team of 5 engineers through the billing launch');
  });

  it('a permanent failure leaves the CV unchanged and the question failed (AC-9.5)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const before = await prisma.cv.findUniqueOrThrow({ where: { id: cv.cvId } });
    llm.permanent(400);
    const jobId = await apply(cv, 'Shipped billing.');
    const job = await waitForJob(prisma, jobId, ['completed', 'failed']);
    expect(job).toMatchObject({ status: 'failed', errorCode: 'LLM_UNAVAILABLE' });

    const after = await prisma.cv.findUniqueOrThrow({ where: { id: cv.cvId } });
    expect(after).toMatchObject({
      status: 'ready',
      version: before.version,
      document: before.document,
    });
    const q = await prisma.question.findUniqueOrThrow({
      where: { id: cv.question(bulletsPath(cv)).id },
    });
    expect(q).toMatchObject({ status: 'failed', answer: 'Shipped billing.' });
    // Retry: answering a failed question again starts a new job.
    const retry = await apply(cv, 'Shipped billing.', q.id);
    expect((await waitForJob(prisma, retry, ['completed', 'failed'])).status).toBe('completed');
  });

  it('shows the running job on the CV so the section can say "Updating…" (AC-9.4)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    llm.slow(400);
    const jobId = await apply(cv, 'Shipped billing.');
    const detail = await getDetail(app, cv.cvId, cookie);
    expect(detail.activeJobs).toContainEqual(
      expect.objectContaining({ id: jobId, type: 'apply_answer', questionId: expect.any(String) }),
    );
    expect(detail.questions.find((q) => q.path === bulletsPath(cv))?.status).toBe('applying');
    await waitForJob(prisma, jobId, ['completed', 'failed']);
  });
});
