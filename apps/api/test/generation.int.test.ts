import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import type { CvDetailDto, CvDocument, LlmCvOutput } from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, uniqueQueuePrefix } from './support/app.js';
import { NAMES, signUp } from './support/auth.js';
import { apiGet, createCv, waitForJob } from './support/cvs.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { startTestWorker } from './support/worker.js';

// Generation through the fake LLM: whatever the model returns must pass the schema and the
// grounding check before anything reaches the CV (FR-6, FR-7, FR-8, NFR-R5).

const SOURCE = [
  'Ada Lovelace, ada@example.com, London',
  'Acme Corp - Software engineer, Jan 2020 - present',
  'Cut API latency from 800 ms to 200 ms by adding Redis caching.',
  'Mentored 3 junior engineers.',
  'Skills: TypeScript, Redis',
].join('\n');

function honestOutput(): LlmCvOutput {
  return {
    contact: {
      name: { value: 'Ada Lovelace', evidence: ['Ada Lovelace'] },
      email: { value: 'ada@example.com', evidence: ['ada@example.com'] },
      phone: null,
      city: { value: 'London', evidence: ['London'] },
      links: [],
    },
    summary: 'Software engineer who cut API latency from 800 ms to 200 ms with Redis caching.',
    experience: [
      {
        company: 'Acme Corp',
        title: 'Software Engineer',
        start: '2020-01',
        end: 'present',
        evidence: ['Acme Corp - Software engineer, Jan 2020 - present'],
        bullets: [
          {
            text: 'Cut API latency from 800 ms to 200 ms by adding Redis caching',
            evidence: ['Cut API latency from 800 ms to 200 ms by adding Redis caching.'],
          },
          { text: 'Mentored 3 junior engineers', evidence: ['Mentored 3 junior engineers.'] },
        ],
      },
    ],
    education: [],
    skills: [
      { name: 'TypeScript', evidence: ['TypeScript'] },
      { name: 'Redis', evidence: ['Redis'] },
    ],
    questions: [
      { path: 'experience.0.bullets', type: 'vague', text: 'What else did you ship?' },
      { path: 'contact.phone', type: 'missing', text: 'What phone number should be on your CV?' },
      { path: 'education', type: 'missing', text: 'What is your education?' },
    ],
  };
}

describe('AI generation and grounding (fake LLM)', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let worker: TestingModule;
  let llm: FakeLlmClient;
  let prisma: PrismaService;
  let cookie: string;
  let email: string;

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
    ({ cookie, email } = await signUp(app));
    llm.calls.length = 0;
  });

  async function generate(role = 'Senior Backend Engineer') {
    const { cvId, jobId } = await createCv(app, { cookie, role, text: SOURCE });
    const job = await waitForJob(prisma, jobId, ['completed', 'failed']);
    const detail = (await apiGet(app, `/api/cvs/${cvId}`, cookie)).body as CvDetailDto;
    return { cvId, jobId, job, detail };
  }

  it('writes a grounded draft with its questions alongside (AC-6.1, AC-8.1)', async () => {
    llm.valid(honestOutput());
    const { job, detail } = await generate();
    expect(job.status).toBe('completed');
    const doc = detail.document as CvDocument;
    expect(doc.contact).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(doc.experience[0]!.bullets).toHaveLength(2);
    expect(doc.skills.map((s) => s.name)).toEqual(['TypeScript', 'Redis']);

    const entryId = doc.experience[0]!.id;
    const paths = detail.questions.map((q) => q.path);
    // The LLM's questions, the index path mapped to the entry's id.
    expect(paths).toEqual(
      expect.arrayContaining(['contact.phone', 'education', `experience.${entryId}.bullets`]),
    );
    expect(detail.questions.every((q) => q.status === 'open')).toBe(true);
    const priorities = detail.questions.map((q) => q.priority);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
  });

  it('takes the name and email the sources lack from the account', async () => {
    const out = honestOutput();
    out.contact.name = null;
    out.contact.email = null;
    out.questions.push(
      { path: 'contact.name', type: 'missing', text: 'What is your full name?' },
      { path: 'contact.email', type: 'missing', text: 'What email should employers use?' },
    );
    llm.valid(out);
    const { job, detail } = await generate();
    expect(job.status).toBe('completed');
    expect(detail.document!.contact).toMatchObject({
      name: `${NAMES.firstName} ${NAMES.lastName}`,
      email,
    });
    expect(detail.document!.editedPaths).toEqual([]);
    const paths = detail.questions.map((q) => q.path);
    expect(paths).not.toContain('contact.name');
    expect(paths).not.toContain('contact.email');
  });

  it('keeps the name and email from the sources over the account', async () => {
    llm.valid(honestOutput());
    const { detail } = await generate();
    // The source gives ada@example.com; the account's email is a random other one.
    expect(detail.document!.contact.email).toBe('ada@example.com');
    expect(email).not.toBe('ada@example.com');
  });

  it('removes two fabricated facts, asks two unverified questions, writes a report (AC-7.5)', async () => {
    const out = honestOutput();
    out.experience[0]!.bullets.push({
      text: 'Grew revenue by 45% in a year',
      evidence: ['Cut API latency from 800 ms to 200 ms by adding Redis caching.'],
    });
    out.skills.push({ name: 'Kubernetes', evidence: ['TypeScript'] });
    llm.fabricated(out);

    const { cvId, jobId, detail } = await generate();
    const doc = detail.document as CvDocument;
    expect(JSON.stringify(doc)).not.toMatch(/45%|Kubernetes/);

    const unverified = detail.questions.filter((q) => q.type === 'unverified');
    expect(unverified.map((q) => q.path).sort()).toEqual(
      [`experience.${doc.experience[0]!.id}.bullets`, 'skills'].sort(),
    );
    // Questions never hint at the removed value.
    expect(JSON.stringify(unverified)).not.toMatch(/45%|Kubernetes/);

    const report = await prisma.groundingReport.findFirstOrThrow({ where: { cvId, jobId } });
    expect(report.removed).toBe(2);
    expect(report.items).toEqual([
      { path: `experience.${doc.experience[0]!.id}.bullets`, reason: 'ATOM_NOT_IN_EVIDENCE' },
      { path: 'skills', reason: 'SKILL_NOT_IN_EVIDENCE' },
    ]);
  });

  it('re-requests a summary that claims the target role, then keeps the fixed one (AC-7.7)', async () => {
    const claiming = honestOutput();
    claiming.summary = 'Senior backend engineer with Redis caching experience.';
    llm.valid(claiming).valid(honestOutput());
    const { detail } = await generate();
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.feedback).toMatch(/target role/);
    expect((detail.document as CvDocument).summary).toMatch(/^Software engineer/);
  });

  it('drops a summary that still claims the role and asks a vague question', async () => {
    const claiming = honestOutput();
    claiming.summary = 'Senior backend engineer with Redis caching experience.';
    llm.valid(claiming).valid(claiming);
    const { detail } = await generate();
    expect((detail.document as CvDocument).summary).toBe('');
    expect(detail.questions).toContainEqual(
      expect.objectContaining({ path: 'summary', type: 'vague' }),
    );
  });

  describe('bad LLM output never reaches the CV (NFR-R5, AC-6.6)', () => {
    const huge = honestOutput();
    huge.experience[0]!.bullets[0]!.text = 'x'.repeat(50_000);
    const missingFields = { summary: 'Hi', experience: [] };
    const wrongTypes = { ...honestOutput(), skills: 'TypeScript' };

    it.each([
      ['invalid JSON', '{"contact": {"name": '],
      ['missing fields', missingFields],
      ['wrong types', wrongTypes],
      ['a 50 KB string', huge],
    ])('%s → re-requested, then LLM_INVALID_OUTPUT with nothing written', async (_, bad) => {
      llm.raw(bad, 3);
      const { cvId, job } = await generate();
      expect(job).toMatchObject({ status: 'failed', errorCode: 'LLM_INVALID_OUTPUT' });
      expect(llm.calls).toHaveLength(3);
      expect(llm.calls[1]!.feedback).toEqual(expect.any(String));
      const cv = await prisma.cv.findUniqueOrThrow({ where: { id: cvId } });
      expect(cv).toMatchObject({ document: null, version: 0, status: 'failed' });
      expect(await prisma.question.count({ where: { cvId } })).toBe(0);
    });

    it('strips extra fields instead of storing them', async () => {
      llm.raw({ ...honestOutput(), secret: 'injected', extra: { a: 1 } });
      const { detail } = await generate();
      expect(JSON.stringify(detail.document)).not.toMatch(/injected|extra/);
    });
  });

  it('a re-run replaces questions and the report instead of adding to them (NFR-R7)', async () => {
    llm.valid(honestOutput());
    const { cvId, jobId } = await generate();
    const before = await prisma.question.count({ where: { cvId } });
    // Simulate a duplicate run of the same job writing its result again.
    await prisma.job.update({ where: { id: jobId }, data: { status: 'running' } });
    const { GenerateProcessor } = await import('../src/worker/generate.processor.js');
    llm.valid(honestOutput());
    await worker
      .get(GenerateProcessor)
      .process({ data: { jobId }, attemptsMade: 0, opts: { attempts: 3 } } as never);
    expect(await prisma.question.count({ where: { cvId } })).toBe(before);
    expect(await prisma.groundingReport.count({ where: { cvId } })).toBe(1);
  });
});
