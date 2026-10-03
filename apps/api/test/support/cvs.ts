import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { TEST_ORIGIN } from './app.js';

export interface CreateCvRequest {
  cookie: string;
  role?: string;
  text?: string;
  pdf?: Buffer;
  filename?: string;
  contentType?: string;
  idempotencyKey?: string;
  extraFields?: Record<string, string>;
}

/** `POST /api/cvs` as the web form sends it (multipart). */
export function postCv(app: NestExpressApplication, input: CreateCvRequest) {
  let req = request(app.getHttpServer())
    .post('/api/cvs')
    .set('Origin', TEST_ORIGIN)
    .set('Cookie', input.cookie);
  if (input.idempotencyKey) req = req.set('Idempotency-Key', input.idempotencyKey);
  if (input.role !== undefined) req = req.field('role', input.role);
  if (input.text !== undefined) req = req.field('text', input.text);
  for (const [name, value] of Object.entries(input.extraFields ?? {})) req = req.field(name, value);
  if (input.pdf) {
    req = req.attach('file', input.pdf, {
      filename: input.filename ?? 'cv.pdf',
      contentType: input.contentType ?? 'application/pdf',
    });
  }
  // Without any part, supertest would send no multipart body at all.
  if (input.role === undefined && input.text === undefined && !input.pdf) req = req.field('x', '');
  return req;
}

/** Creates a CV and returns `{ cvId, jobId }`; fails the test unless the API answered 202. */
export async function createCv(app: NestExpressApplication, input: CreateCvRequest) {
  const res = await postCv(app, { role: 'Backend Engineer', ...input });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body as { cvId: string; jobId: string };
}

export function apiGet(app: NestExpressApplication, path: string, cookie: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie);
}

/** Polls until `check` returns a value (not undefined/false), or fails after `timeoutMs`. */
export async function waitFor<T>(
  check: () => Promise<T | undefined | false | null>,
  { timeoutMs = 10_000, intervalMs = 50, what = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== undefined && value !== false && value !== null) return value;
    } catch (err) {
      last = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${String(last)}` : ''}`);
}

/** Waits until the DB job reaches one of `statuses` and returns it. */
export function waitForJob(
  prisma: PrismaService,
  jobId: string,
  statuses: string[],
  timeoutMs = 10_000,
) {
  return waitFor(
    async () => {
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      return job && statuses.includes(job.status) ? job : undefined;
    },
    { timeoutMs, what: `job ${jobId} to be ${statuses.join('/')}` },
  );
}
