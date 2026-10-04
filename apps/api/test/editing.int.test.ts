import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS_GENERAL } from '../src/redis/redis.module.js';
import { createTestApp, uniqueQueuePrefix } from './support/app.js';
import { signUp } from './support/auth.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import {
  answerQuestion,
  dismissQuestion,
  getDetail,
  patchCv,
  readyCv,
} from './support/ready-cv.js';
import { startTestWorker } from './support/worker.js';

// Manual editing, skipping, and simple-field answers (FR-8, FR-9.2, FR-10): no LLM involved.

describe('editing and questions', () => {
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
      JOB_BACKOFF_MS: '50',
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
    llm.calls.length = 0;
    llm.sectionCalls.length = 0;
  });

  const cvRow = (id: string) => prisma.cv.findUniqueOrThrow({ where: { id } });

  describe('PATCH /api/cvs/:id (AC-10.1, AC-10.4, AC-10.6)', () => {
    it('saves ops, marks them edited, bumps version but not aiRevision', async () => {
      const cv = await readyCv(app, prisma, llm, cookie);
      const before = await cvRow(cv.cvId);
      const bulletPath = `experience.${cv.entryId}.bullets.${cv.bulletIds[1]}`;
      const res = await patchCv(app, cv.cvId, cookie, {
        baseVersion: cv.version,
        ops: [{ op: 'set', path: bulletPath, value: 'Led a team of 5 engineers' }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual({
        version: cv.version + 1,
        resolvedQuestionIds: [expect.any(String)],
      });

      const after = await cvRow(cv.cvId);
      expect(after.version).toBe(before.version + 1);
      expect(after.aiRevision).toBe(before.aiRevision);
      const detail = await getDetail(app, cv.cvId, cookie);
      expect(detail.document!.experience[0]!.bullets[1]!.text).toBe('Led a team of 5 engineers');
      expect(detail.document!.editedPaths).toEqual([bulletPath]);
      // The vague question on these bullets is resolved by the manual edit (AC-8.6).
      const vague = detail.questions.find((q) => q.path === `experience.${cv.entryId}.bullets`);
      expect(vague?.status).toBe('resolved');
      expect(res.body.resolvedQuestionIds).toEqual([vague!.id]);
    });

    it('rejects a stale baseVersion with 409 and the current state, CV unchanged', async () => {
      const cv = await readyCv(app, prisma, llm, cookie);
      const ok = await patchCv(app, cv.cvId, cookie, {
        baseVersion: cv.version,
        ops: [{ op: 'set', path: 'summary', value: 'Second tab wins.' }],
      });
      expect(ok.status).toBe(200);
      const stale = await patchCv(app, cv.cvId, cookie, {
        baseVersion: cv.version,
        ops: [{ op: 'set', path: 'summary', value: 'Stale tab.' }],
      });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({
        code: 'VERSION_CONFLICT',
        current: { version: cv.version + 1, document: { summary: 'Second tab wins.' } },
      });
      expect((await getDetail(app, cv.cvId, cookie)).document!.summary).toBe('Second tab wins.');
    });

    it('rejects invalid data with 400 and changes nothing', async () => {
      const cv = await readyCv(app, prisma, llm, cookie);
      for (const ops of [
        [
          {
            op: 'set',
            path: `experience.${cv.entryId}.bullets.${cv.bulletIds[0]}`,
            value: 'x'.repeat(501),
          },
        ],
        [{ op: 'set', path: 'contact.email', value: 'not-an-email' }],
        [{ op: 'set', path: 'experience', value: [] }],
        [{ op: 'remove', path: 'summary' }],
      ]) {
        const res = await patchCv(app, cv.cvId, cookie, { baseVersion: cv.version, ops });
        expect(res.status, JSON.stringify(ops)).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
      expect((await cvRow(cv.cvId)).version).toBe(cv.version);
    });

    it('is 404 for another user’s CV', async () => {
      const cv = await readyCv(app, prisma, llm, cookie);
      const other = await signUp(app);
      const res = await patchCv(app, cv.cvId, other.cookie, {
        baseVersion: cv.version,
        ops: [{ op: 'set', path: 'summary', value: 'Hijacked' }],
      });
      expect(res.status).toBe(404);
      expect((await cvRow(cv.cvId)).version).toBe(cv.version);
    });
  });

  describe('questions', () => {
    it('skip → dismissed, CV unchanged; a second skip is 409 (AC-8.4)', async () => {
      const cv = await readyCv(app, prisma, llm, cookie);
      const q = cv.question('contact.phone');
      expect((await dismissQuestion(app, cv.cvId, q.id, cookie)).status).toBe(204);
      const detail = await getDetail(app, cv.cvId, cookie);
      expect(detail.questions.find((x) => x.id === q.id)?.status).toBe('dismissed');
      expect(detail.version).toBe(cv.version);
      const again = await dismissQuestion(app, cv.cvId, q.id, cookie);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('QUESTION_NOT_OPEN');
    });

    it('writes a simple field directly, without the LLM (AC-9.2)', async () => {
      const cv = await readyCv(app, prisma, llm, cookie);
      const q = cv.question('contact.phone');
      const res = await answerQuestion(app, cv.cvId, q.id, cookie, '+44 20 7946 0958');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'answered', version: cv.version + 1 });
      expect(llm.sectionCalls).toHaveLength(0);

      const detail = await getDetail(app, cv.cvId, cookie);
      expect(detail.document!.contact.phone).toBe('+44 20 7946 0958');
      expect(detail.document!.editedPaths).toContain('contact.phone');
      expect(detail.questions.find((x) => x.id === q.id)).toMatchObject({
        status: 'answered',
        answer: '+44 20 7946 0958',
      });
      const answers = await prisma.sourceText.findMany({
        where: { cvId: cv.cvId, kind: 'answer' },
      });
      expect(answers.map((a) => a.text)).toEqual(['+44 20 7946 0958']);
    });

    it('rejects an invalid simple answer and an empty answer with 400', async () => {
      const cv = await readyCv(app, prisma, llm, cookie);
      const q = cv.question('contact.phone');
      const bad = await answerQuestion(app, cv.cvId, q.id, cookie, 'call me maybe');
      expect(bad.status).toBe(400);
      expect(bad.body.fields).toHaveProperty('answer');
      const empty = await answerQuestion(app, cv.cvId, q.id, cookie, '   ');
      expect(empty.status).toBe(400);
      const detail = await getDetail(app, cv.cvId, cookie);
      expect(detail.document!.contact.phone).toBe('');
      expect(detail.questions.find((x) => x.id === q.id)?.status).toBe('open');
      expect(await prisma.sourceText.count({ where: { cvId: cv.cvId, kind: 'answer' } })).toBe(0);
    });

    it('limits AI-applied answers per hour with 429 (NFR-S9)', async () => {
      const cv = await readyCv(app, prisma, llm, cookie);
      const redis = app.get<Redis>(REDIS_GENERAL);
      const hour = Math.floor(Date.now() / 3_600_000);
      await redis.set(`rl:ans:${userId}:${hour}`, '60', 'EX', 3600);
      const q = cv.question(`experience.${cv.entryId}.bullets`);
      const res = await answerQuestion(app, cv.cvId, q.id, cookie, 'Shipped billing in 2021.');
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(await prisma.job.count({ where: { cvId: cv.cvId, type: 'apply_answer' } })).toBe(0);
    });
  });
});
