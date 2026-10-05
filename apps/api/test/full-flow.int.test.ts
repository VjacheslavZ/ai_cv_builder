import { Writable } from 'node:stream';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import type { CvDetailDto, QuestionDto } from '@cv/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, TEST_ORIGIN, uniqueQueuePrefix } from './support/app.js';
import { NAMES, PASSWORD, randomEmail, sessionToken, signUp } from './support/auth.js';
import { apiGet, createCv, waitForJob } from './support/cvs.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { getPdf, parsePdf } from './support/pdf.js';
import { answerQuestion, dismissQuestion, getDetail, patchCv } from './support/ready-cv.js';
import { startTestWorker } from './support/worker.js';
import { SAMPLE_TEXT, validPdf } from './fixtures/pdf/pdf-fixtures.js';

/** A fake key: it must never show up in a log line. */
const API_KEY = 'sk-ant-test-0123456789abcdef-never-logged';
const PHONE = '+1 555 010 0199';
const SUMMARY_ANSWER = 'Backend engineer who keeps billing systems fast and correct.';
const EDITED_BULLET = 'Mentored four engineers through weekly design reviews.';

/** Collects every log line (pino writes one JSON object per line). */
function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      done();
    },
  });
  return { lines, stream };
}

/**
 * The whole P0 path through the real HTTP app and worker with `FakeLlmClient` (SPEC §5.4):
 * sign up → create from PDF → ready → answer (simple and LLM) → dismiss → edit → PDF → delete.
 * The same run proves that nothing personal reaches the logs (NFR-R8, NFR-S11) and that auth
 * routes and CV JSON routes both work in one app (the `bodyParser` regression, SPEC §7).
 */
describe('full flow (e2e API)', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  const logs = captureLogs();

  beforeAll(async () => {
    db = await createTestDatabase();
    const env = {
      BULLMQ_PREFIX: uniqueQueuePrefix(),
      LOG_LEVEL: 'trace',
      ANTHROPIC_API_KEY: API_KEY,
    };
    app = await createTestApp({ databaseUrl: db.url, env, logDestination: logs.stream });
    worker = await startTestWorker({
      databaseUrl: db.url,
      env,
      llm: new FakeLlmClient(),
      logDestination: logs.stream,
    });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    await db?.drop();
  });

  const secrets: string[] = [
    API_KEY,
    PASSWORD,
    NAMES.lastName,
    PHONE,
    SUMMARY_ANSWER,
    EDITED_BULLET,
  ];

  function question(detail: CvDetailDto, match: (q: QuestionDto) => boolean): QuestionDto {
    const q = detail.questions.find((x) => x.status === 'open' && match(x));
    expect(q, 'an open question').toBeDefined();
    return q!;
  }

  it('runs from sign-up to deletion, and logs nothing personal', async () => {
    // Sign up (an auth route: better-auth reads the raw body).
    const email = randomEmail();
    const { cookie } = await signUp(app, email);
    secrets.push(email, sessionToken(cookie));
    const me = await apiGet(app, '/api/cvs', cookie);
    expect(me.status).toBe(200);
    expect(me.body).toEqual([]);

    // Create from a PDF and wait for the draft.
    const { cvId, jobId } = await createCv(app, {
      cookie,
      role: 'Backend Engineer',
      pdf: validPdf(),
    });
    expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).status).toBe('completed');
    let detail = await getDetail(app, cvId, cookie);
    expect(detail.status).toBe('ready');
    expect(detail.document!.experience[0]!.bullets.length).toBeGreaterThan(0);

    // A simple field: written directly, no LLM (AC-9.2).
    const phone = question(detail, (q) => q.path === 'contact.phone');
    const simple = await answerQuestion(app, cvId, phone.id, cookie, PHONE);
    expect(simple.status, JSON.stringify(simple.body)).toBe(200);
    expect(simple.body).toMatchObject({ status: 'answered' });

    // A section: an `apply_answer` job rewrites it (AC-9.1).
    detail = await getDetail(app, cvId, cookie);
    const summary = question(detail, (q) => q.path === 'summary');
    const applied = await answerQuestion(app, cvId, summary.id, cookie, SUMMARY_ANSWER);
    expect(applied.status, JSON.stringify(applied.body)).toBe(202);
    const applyJob = await waitForJob(prisma, applied.body.jobId, ['completed', 'failed']);
    expect(applyJob.status).toBe('completed');

    // Skip a question (AC-8.4).
    detail = await getDetail(app, cvId, cookie);
    const education = question(detail, (q) => q.path === 'education');
    expect((await dismissQuestion(app, cvId, education.id, cookie)).status).toBe(204);

    // A manual edit (a JSON route through our body parser).
    detail = await getDetail(app, cvId, cookie);
    const entry = detail.document!.experience[0]!;
    const bullet = entry.bullets.at(-1)!;
    const patched = await patchCv(app, cvId, cookie, {
      baseVersion: detail.version,
      ops: [
        { op: 'set', path: `experience.${entry.id}.bullets.${bullet.id}`, value: EDITED_BULLET },
      ],
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    detail = await getDetail(app, cvId, cookie);
    expect(detail.document!.contact.phone).toBe(PHONE);
    expect(detail.document!.summary).toBe(SUMMARY_ANSWER);
    expect(detail.questions.find((q) => q.id === education.id)?.status).toBe('dismissed');

    // The PDF holds the saved document, open questions and all (AC-8.3, AC-11.3).
    const pdf = await getPdf(app, cvId, cookie);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const { text } = await parsePdf(pdf.body as Buffer);
    expect(text).toContain(SUMMARY_ANSWER);
    expect(text).toContain(EDITED_BULLET);
    expect(text).toContain(PHONE);

    // Delete, and everything is gone.
    const deleted = await request(app.getHttpServer())
      .delete(`/api/cvs/${cvId}`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookie);
    expect(deleted.status).toBe(204);
    expect((await apiGet(app, `/api/cvs/${cvId}`, cookie)).status).toBe(404);
    expect((await apiGet(app, `/api/cvs/${cvId}/pdf`, cookie)).status).toBe(404);
    expect((await apiGet(app, '/api/cvs', cookie)).body).toEqual([]);

    // Sign out (another auth route).
    const out = await request(app.getHttpServer())
      .post('/api/auth/sign-out')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookie)
      .send({});
    expect(out.status).toBe(200);
    expect((await apiGet(app, '/api/cvs', cookie)).status).toBe(401);
  });

  it('logged the flow, without email, CV text, answers, keys, or tokens (NFR-R8)', () => {
    expect(logs.lines.length).toBeGreaterThan(10);
    // The capture saw both processes' kinds of lines: requests and job stages.
    expect(logs.lines.some((l) => l.includes('"requestId"'))).toBe(true);
    expect(logs.lines.some((l) => l.includes(`"jobId"`))).toBe(true);

    const all = logs.lines.join('\n');
    const sourceLines = SAMPLE_TEXT.split('\n');
    for (const needle of [...secrets, ...sourceLines]) {
      expect(all, `log contains "${needle}"`).not.toContain(needle);
    }
    // Not even a fragment of the CV text (e.g. a bullet cut short in an error message).
    for (const line of sourceLines) {
      expect(all, `log contains part of "${line}"`).not.toContain(line.slice(0, 24));
    }
  });
});
