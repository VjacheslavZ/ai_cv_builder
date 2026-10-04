import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import type { CvDocument } from '@cv/shared';
import { extractText, getDocumentProxy } from 'unpdf';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, uniqueQueuePrefix } from './support/app.js';
import { signUp } from './support/auth.js';
import { createCv, waitForJob } from './support/cvs.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { patchCv, readyCv, type ReadyCv } from './support/ready-cv.js';
import { startTestWorker } from './support/worker.js';

// FR-11: the PDF export, rendered from the saved document.

/** The PDF as bytes (supertest buffers only text bodies by default). */
function getPdf(app: NestExpressApplication, cvId: string, cookie: string) {
  return request(app.getHttpServer())
    .get(`/api/cvs/${cvId}/pdf`)
    .set('Cookie', cookie)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
}

interface ParsedPdf {
  pages: { width: number; height: number; text: string }[];
  text: string;
}

async function parsePdf(bytes: Buffer): Promise<ParsedPdf> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = await Promise.all(
    text.map(async (pageText, i) => {
      const { width, height } = (await pdf.getPage(i + 1)).getViewport({ scale: 1 });
      return { width, height, text: pageText };
    }),
  );
  await pdf.loadingTask.destroy();
  return { pages, text: text.join('\n') };
}

/** `needles` appear in `text` in this order. */
function expectInOrder(text: string, needles: string[]) {
  let from = 0;
  for (const needle of needles) {
    const at = text.indexOf(needle, from);
    expect(at, `"${needle}" after position ${from}`).toBeGreaterThanOrEqual(0);
    from = at + needle.length;
  }
}

describe('GET /api/cvs/:id/pdf', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let worker: TestingModule;
  let llm: FakeLlmClient;
  let prisma: PrismaService;
  let cookie: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const env = { BULLMQ_PREFIX: uniqueQueuePrefix(), MAX_ACTIVE_GENERATIONS_PER_USER: '50' };
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
  });

  /** Replaces the saved document directly: the shapes below are hard to reach through answers. */
  async function saveDocument(cv: ReadyCv, edit: (doc: CvDocument) => CvDocument) {
    await prisma.cv.update({
      where: { id: cv.cvId },
      data: { document: edit(structuredClone(cv.doc)) as object, version: { increment: 1 } },
    });
  }

  it('renders an A4 PDF with selectable text, open questions or not (AC-11.1, AC-11.2, AC-8.3)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    expect(cv.questions.some((q) => q.status === 'open')).toBe(true);

    const res = await getPdf(app, cv.cvId, cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="Ada_Lovelace_CV.pdf"; filename*=UTF-8''Ada_Lovelace_CV.pdf`,
    );
    expect(res.headers['cache-control']).toBe('no-store');

    const pdf = await parsePdf(res.body as Buffer);
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.pages[0]!.width).toBeCloseTo(595, 0);
    expect(pdf.pages[0]!.height).toBeCloseTo(842, 0);
    expectInOrder(pdf.text, [
      'Ada Lovelace',
      'ada@example.com',
      'London',
      'Summary',
      'Experience',
      'Software engineer, Acme Corp',
      'Jan 2020 – Present',
      'Cut API latency from 800 ms to 200 ms by adding Redis caching',
      'Mentored 3 junior engineers',
      'Skills',
      'TypeScript',
      'Redis',
    ]);
  });

  it('leaves out empty fields and sections, with no placeholders (AC-11.5)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const pdf = await parsePdf((await getPdf(app, cv.cvId, cookie)).body as Buffer);
    // No phone and no education in this CV.
    expect(pdf.text).not.toContain('Education');
    expect(pdf.text).not.toMatch(/TODO|undefined|null|\[|·\s*·/);

    await saveDocument(cv, (doc) => ({ ...doc, summary: '', skills: [] }));
    const bare = await parsePdf((await getPdf(app, cv.cvId, cookie)).body as Buffer);
    expect(bare.text).not.toContain('Summary');
    expect(bare.text).not.toContain('Skills');
    expect(bare.text).toContain('Experience');
  });

  it('embeds a Latin Extended font and names the file after an accented name (AC-11.4, AC-11.6)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    await saveDocument(cv, (doc) => ({
      ...doc,
      contact: { ...doc.contact, name: 'José Müller-Łukasiewicz', city: 'Łódź' },
    }));

    const res = await getPdf(app, cv.cvId, cookie);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="Jose_Muller-_ukasiewicz_CV.pdf"; ` +
        `filename*=UTF-8''Jos%C3%A9_M%C3%BCller-%C5%81ukasiewicz_CV.pdf`,
    );
    const body = res.body as Buffer;
    expect(body.toString('latin1')).toMatch(/\/FontFile2/);
    expect(body.toString('latin1')).toMatch(/NotoSans-Bold/);
    const pdf = await parsePdf(body);
    expect(pdf.text).toContain('José Müller-Łukasiewicz');
    expect(pdf.text).toContain('Łódź');
  });

  it('flows a long CV onto more pages without losing a bullet (AC-11.4)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const entries = Array.from({ length: 12 }, (_, e) => ({
      id: randomUUID(),
      company: `Company ${e}`,
      title: 'Engineer',
      dates: { start: `${2000 + e}-03`, end: `${2001 + e}-06` },
      bullets: Array.from({ length: 8 }, (_, b) => ({
        id: randomUUID(),
        text: `Bullet E${e}B${b}: shipped a feature that improved the conversion of the checkout flow measurably.`,
      })),
    }));
    await saveDocument(cv, (doc) => ({ ...doc, experience: entries }));

    const pdf = await parsePdf((await getPdf(app, cv.cvId, cookie)).body as Buffer);
    expect(pdf.pages.length).toBeGreaterThan(1);
    for (const page of pdf.pages) {
      expect(page.width).toBeCloseTo(595, 0);
      expect(page.height).toBeCloseTo(842, 0);
    }
    expectInOrder(
      pdf.text,
      entries.flatMap((e, i) => [`Company ${i}`, ...e.bullets.map((_, b) => `Bullet E${i}B${b}:`)]),
    );
  });

  it('renders the latest saved version right after a PATCH (AC-11.3)', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const res = await patchCv(app, cv.cvId, cookie, {
      baseVersion: cv.version,
      ops: [{ op: 'set', path: 'summary', value: 'Freshly edited summary text' }],
    });
    expect(res.status).toBe(200);
    const pdf = await parsePdf((await getPdf(app, cv.cvId, cookie)).body as Buffer);
    expect(pdf.text).toContain('Freshly edited summary text');
  });

  it('falls back to CV.pdf when the name is empty', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    await saveDocument(cv, (doc) => ({ ...doc, contact: { ...doc.contact, name: '' } }));
    const res = await getPdf(app, cv.cvId, cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="CV.pdf"; filename*=UTF-8''CV.pdf`,
    );
  });

  it('answers 409 CV_NOT_EDITABLE before the first draft', async () => {
    llm.permanent();
    const { cvId, jobId } = await createCv(app, { cookie, text: 'Some source text' });
    await waitForJob(prisma, jobId, ['failed']);
    const res = await request(app.getHttpServer())
      .get(`/api/cvs/${cvId}/pdf`)
      .set('Cookie', cookie);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CV_NOT_EDITABLE' });
  });

  it('answers 404 for a CV of another user and 401 without a session', async () => {
    const cv = await readyCv(app, prisma, llm, cookie);
    const other = await signUp(app);
    const foreign = await request(app.getHttpServer())
      .get(`/api/cvs/${cv.cvId}/pdf`)
      .set('Cookie', other.cookie);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ code: 'NOT_FOUND' });
    const anonymous = await request(app.getHttpServer()).get(`/api/cvs/${cv.cvId}/pdf`);
    expect(anonymous.status).toBe(401);
  });
});
