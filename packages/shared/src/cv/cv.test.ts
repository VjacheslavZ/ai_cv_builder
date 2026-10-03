import { describe, expect, it } from 'vitest';
import {
  createCvSchema,
  cvDateRangeSchema,
  cvDocumentSchema,
  cvUrlSchema,
  emptyCvDocument,
  idempotencyKeySchema,
  PDF_MAX_BYTES,
  ROLE_MAX_LENGTH,
  SOURCE_TEXT_MAX_LENGTH,
} from './index.js';

const E = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';
const B = '7d9e8f00-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

function fieldErrors(input: unknown): Record<string, string> {
  const result = createCvSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('createCvSchema', () => {
  it('accepts a role with text, a file, or both', () => {
    expect(createCvSchema.parse({ role: ' Backend Engineer ', text: 'I build APIs' })).toEqual({
      role: 'Backend Engineer',
      text: 'I build APIs',
    });
    const file = { size: 1024, name: 'cv.pdf' };
    expect(createCvSchema.parse({ role: 'Dev', file }).file).toBe(file);
    expect(createCvSchema.safeParse({ role: 'Dev', text: 'x', file }).success).toBe(true);
  });

  it('requires a role (AC-3.2)', () => {
    expect(fieldErrors({ text: 'x' })).toHaveProperty('role');
    expect(fieldErrors({ role: '   ', text: 'x' })).toHaveProperty('role');
  });

  it('requires text or a file, reported on `text` (AC-3.2)', () => {
    expect(fieldErrors({ role: 'Dev' })).toEqual({ text: 'Upload a PDF or paste your experience' });
    expect(fieldErrors({ role: 'Dev', text: '   ', file: null })).toHaveProperty('text');
  });

  it('enforces the input limits (AC-3.3)', () => {
    expect(fieldErrors({ role: 'r'.repeat(ROLE_MAX_LENGTH + 1), text: 'x' })).toHaveProperty(
      'role',
    );
    expect(createCvSchema.safeParse({ role: 'r'.repeat(ROLE_MAX_LENGTH), text: 'x' }).success).toBe(
      true,
    );
    expect(
      fieldErrors({ role: 'Dev', text: 't'.repeat(SOURCE_TEXT_MAX_LENGTH + 1) }),
    ).toHaveProperty('text');
    expect(fieldErrors({ role: 'Dev', file: { size: PDF_MAX_BYTES + 1 } })).toHaveProperty('file');
    expect(fieldErrors({ role: 'Dev', file: { size: 0 } })).toHaveProperty('file');
  });

  it('strips unknown fields such as userId (AC-2.3)', () => {
    expect(createCvSchema.parse({ role: 'Dev', text: 'x', userId: 'someone' })).not.toHaveProperty(
      'userId',
    );
  });
});

describe('idempotencyKeySchema', () => {
  it('accepts UUIDs and rejects junk', () => {
    expect(idempotencyKeySchema.safeParse(E).success).toBe(true);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('has spaces in it').success).toBe(false);
  });
});

describe('CvDocument', () => {
  const doc = {
    contact: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '',
      city: 'London',
      links: [{ id: B, label: 'Site', url: 'https://ada.dev' }],
    },
    summary: 'Engineer.',
    experience: [
      {
        id: E,
        company: 'Acme',
        title: 'Engineer',
        dates: { start: '2020-01', end: 'present' },
        bullets: [{ id: B, text: 'Built things' }],
      },
    ],
    education: [],
    skills: [{ id: B, name: 'TypeScript' }],
  };

  it('accepts a valid document and defaults editedPaths', () => {
    expect(cvDocumentSchema.parse(doc).editedPaths).toEqual([]);
    expect(cvDocumentSchema.parse(emptyCvDocument())).toEqual(emptyCvDocument());
  });

  it('requires UUIDs on entries, bullets, links, and skills', () => {
    const bad = { ...doc, skills: [{ id: 'python', name: 'Python' }] };
    expect(cvDocumentSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts field and section paths in editedPaths only', () => {
    expect(
      cvDocumentSchema.safeParse({ ...doc, editedPaths: ['summary', `experience.${E}.bullets`] })
        .success,
    ).toBe(true);
    expect(cvDocumentSchema.safeParse({ ...doc, editedPaths: ['nope.path'] }).success).toBe(false);
  });

  it('caps bullet length', () => {
    const long = structuredClone(doc);
    long.experience[0]!.bullets[0]!.text = 'x'.repeat(501);
    expect(cvDocumentSchema.safeParse(long).success).toBe(false);
  });
});

describe('dates', () => {
  it.each([
    [{ start: '2020', end: '2021' }, true],
    [{ start: '2020-03', end: 'present' }, true],
    [{ start: '2020-05', end: '2020' }, true],
    [{ start: '2020-05', end: '2020-03' }, false],
    [{ start: '2021', end: '2020' }, false],
    [{ start: '2020-13', end: 'present' }, false],
    [{ start: 'Jan 2020', end: 'present' }, false],
    [{ start: 'present', end: '2020' }, false],
  ])('%j → %s', (range, ok) => {
    expect(cvDateRangeSchema.safeParse(range).success).toBe(ok);
  });
});

describe('links', () => {
  it.each([
    ['https://example.com/a', true],
    ['http://example.com', true],
    ['mailto:ada@example.com', true],
    ['javascript:alert(1)', false],
    ['data:text/html,hi', false],
    ['ftp://example.com', false],
    ['example.com', false],
  ])('%s → %s', (url, ok) => {
    expect(cvUrlSchema.safeParse(url).success).toBe(ok);
  });
});
