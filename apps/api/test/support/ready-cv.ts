import type { NestExpressApplication } from '@nestjs/platform-express';
import type { CvDetailDto, CvDocument, LlmCvOutput, QuestionDto } from '@cv/shared';
import request from 'supertest';
import { expect } from 'vitest';
import type { FakeLlmClient } from '../../src/llm/fake-llm-client.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { TEST_ORIGIN } from './app.js';
import { apiGet, createCv, waitForJob } from './cvs.js';

/** The source of every Phase 4 test CV. */
export const READY_SOURCE = [
  'Ada Lovelace, ada@example.com, London',
  'Acme Corp - Software engineer, Jan 2020 - present',
  'Cut API latency from 800 ms to 200 ms by adding Redis caching.',
  'Mentored 3 junior engineers.',
  'Skills: TypeScript, Redis',
].join('\n');

/** A grounded draft of `READY_SOURCE` with a vague question on the Acme bullets and no phone. */
export function readyOutput(): LlmCvOutput {
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
        title: 'Software engineer',
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
      { path: 'contact.phone', type: 'missing', text: 'What phone number should be on your CV?' },
      { path: 'experience.0.bullets', type: 'vague', text: 'What else did you achieve at Acme?' },
    ],
  };
}

export interface ReadyCv {
  cvId: string;
  doc: CvDocument;
  version: number;
  questions: QuestionDto[];
  /** The Acme entry id and its two bullet ids. */
  entryId: string;
  bulletIds: [string, string];
  question(path: string): QuestionDto;
}

/** Generates a CV from `readyOutput()` and waits until it is ready. */
export async function readyCv(
  app: NestExpressApplication,
  prisma: PrismaService,
  llm: FakeLlmClient,
  cookie: string,
): Promise<ReadyCv> {
  llm.valid(readyOutput());
  const { cvId, jobId } = await createCv(app, { cookie, role: 'Engineer', text: READY_SOURCE });
  expect((await waitForJob(prisma, jobId, ['completed', 'failed'])).status).toBe('completed');
  const detail = await getDetail(app, cvId, cookie);
  const doc = detail.document!;
  const entry = doc.experience[0]!;
  return {
    cvId,
    doc,
    version: detail.version,
    questions: detail.questions,
    entryId: entry.id,
    bulletIds: [entry.bullets[0]!.id, entry.bullets[1]!.id],
    question: (path) => {
      const q = detail.questions.find((x) => x.path === path);
      if (!q) throw new Error(`No question at ${path}`);
      return q;
    },
  };
}

export async function getDetail(
  app: NestExpressApplication,
  cvId: string,
  cookie: string,
): Promise<CvDetailDto> {
  const res = await apiGet(app, `/api/cvs/${cvId}`, cookie);
  expect(res.status).toBe(200);
  return res.body as CvDetailDto;
}

export function patchCv(app: NestExpressApplication, cvId: string, cookie: string, body: unknown) {
  return request(app.getHttpServer())
    .patch(`/api/cvs/${cvId}`)
    .set('Origin', TEST_ORIGIN)
    .set('Cookie', cookie)
    .send(body as object);
}

export function answerQuestion(
  app: NestExpressApplication,
  cvId: string,
  questionId: string,
  cookie: string,
  answer: string,
) {
  return request(app.getHttpServer())
    .post(`/api/cvs/${cvId}/questions/${questionId}/answer`)
    .set('Origin', TEST_ORIGIN)
    .set('Cookie', cookie)
    .send({ answer });
}

export function dismissQuestion(
  app: NestExpressApplication,
  cvId: string,
  questionId: string,
  cookie: string,
) {
  return request(app.getHttpServer())
    .post(`/api/cvs/${cvId}/questions/${questionId}/dismiss`)
    .set('Origin', TEST_ORIGIN)
    .set('Cookie', cookie);
}
