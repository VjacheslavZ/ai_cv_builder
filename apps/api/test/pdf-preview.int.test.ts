import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, uniqueQueuePrefix } from './support/app.js';
import { signUp } from './support/auth.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { getPdf, parsePdf } from './support/pdf.js';
import { patchCv, readyCv } from './support/ready-cv.js';
import { startTestWorker } from './support/worker.js';

const PREVIEWS_PER_MINUTE = 3;

/**
 * The limit is counted per clock minute: start a counting test with enough of the minute left,
 * so its requests all land in one window.
 */
async function awayFromMinuteEnd(marginMs = 10_000) {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < marginMs) await new Promise((resolve) => setTimeout(resolve, left + 50));
}

// AC-11.7: the live preview is the saved PDF, inline, frameable by the web origin only.

describe('GET /api/cvs/:id/pdf/preview', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let worker: TestingModule;
  let llm: FakeLlmClient;
  let prisma: PrismaService;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const env = {
      BULLMQ_PREFIX: uniqueQueuePrefix(),
      MAX_ACTIVE_GENERATIONS_PER_USER: '50',
      PDF_PREVIEWS_PER_MINUTE: String(PREVIEWS_PER_MINUTE),
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
    ({ cookie, userId } = await signUp(app));
  });

  it('is the saved PDF, inline, and only the web origin may frame it', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const res = await getPdf(app, cv.cvId, cookie, { preview: true });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'self'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect((await parsePdf(res.body as Buffer)).text).toContain('Ada Lovelace');
  });

  it('leaves the download as it was: attachment, never framed', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const res = await getPdf(app, cv.cvId, cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('shows the latest save, read from the database every time (AC-11.3)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const before = await getPdf(app, cv.cvId, cookie, { preview: true });
    expect((await parsePdf(before.body as Buffer)).text).not.toContain('Typed a moment ago');

    const saved = await patchCv(app, cv.cvId, cookie, {
      baseVersion: cv.version,
      ops: [{ op: 'set', path: 'summary', value: 'Typed a moment ago.' }],
    });
    expect(saved.status).toBe(200);
    const after = await getPdf(app, cv.cvId, cookie, { preview: true });
    expect((await parsePdf(after.body as Buffer)).text).toContain('Typed a moment ago.');
  });

  it('is 409 before the first draft, without using up the limit', async () => {
    // Still generating: no document yet (made directly, so no job can finish it meanwhile).
    const { id: cvId } = await prisma.cv.create({
      data: { userId, title: 'Engineer', targetRole: 'Engineer' },
    });
    await awayFromMinuteEnd();
    for (let i = 0; i < PREVIEWS_PER_MINUTE + 1; i++) {
      const res = await getPdf(app, cvId, cookie, { preview: true });
      expect(res.status).toBe(409);
      expect(JSON.parse((res.body as Buffer).toString())).toMatchObject({
        code: 'CV_NOT_EDITABLE',
      });
    }
  });

  it('past the per-minute limit: 429, and the download still works (NFR-S9)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    await awayFromMinuteEnd();
    for (let i = 0; i < PREVIEWS_PER_MINUTE; i++) {
      expect((await getPdf(app, cv.cvId, cookie, { preview: true })).status).toBe(200);
    }
    const limited = await getPdf(app, cv.cvId, cookie, { preview: true });
    expect(limited.status).toBe(429);
    expect(JSON.parse((limited.body as Buffer).toString())).toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect((await getPdf(app, cv.cvId, cookie)).status).toBe(200);
  });
});
