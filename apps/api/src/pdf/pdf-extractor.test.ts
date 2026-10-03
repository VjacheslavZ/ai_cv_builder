import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env.schema.js';
import {
  corruptedPdf,
  encryptedPdf,
  scanPdf,
  validPdf,
} from '../../test/fixtures/pdf/pdf-fixtures.js';
import { countMeaningfulChars, PdfExtractor } from './pdf-extractor.js';

const env = {
  DATABASE_URL: 'postgresql://cv:cv@localhost:5432/cv',
  REDIS_URL: 'redis://localhost:6379',
};
const extractor = new PdfExtractor(loadConfig(env));

describe('PdfExtractor (worker_thread)', () => {
  it('extracts the text of a valid PDF', async () => {
    const result = await extractor.extract(validPdf());
    expect(result).toMatchObject({ ok: true, pages: 1 });
    expect(result.ok && result.text).toContain('Cut p95 API latency from 800 ms to 200 ms');
  });

  it('accepts 10 pages and rejects 11', async () => {
    expect(await extractor.extract(validPdf(10))).toMatchObject({ ok: true, pages: 10 });
    expect(await extractor.extract(validPdf(11))).toEqual({
      ok: false,
      code: 'PDF_TOO_MANY_PAGES',
    });
  });

  it('returns no meaningful text for a scan', async () => {
    const result = await extractor.extract(scanPdf());
    expect(result.ok).toBe(true);
    expect(countMeaningfulChars(result.ok ? result.text : 'x')).toBe(0);
  });

  it('reports encrypted and corrupted files', async () => {
    expect(await extractor.extract(encryptedPdf())).toEqual({ ok: false, code: 'PDF_ENCRYPTED' });
    expect(await extractor.extract(corruptedPdf())).toEqual({ ok: false, code: 'PDF_CORRUPTED' });
  });

  it('gives up after the timeout', async () => {
    const fast = new PdfExtractor(loadConfig({ ...env, PDF_EXTRACTION_TIMEOUT_MS: '1' }));
    expect(await fast.extract(validPdf(10))).toEqual({ ok: false, code: 'PDF_CORRUPTED' });
  });
});

describe('countMeaningfulChars', () => {
  it('counts letters and digits in any script', () => {
    expect(countMeaningfulChars('  -- . , \n\t ')).toBe(0);
    expect(countMeaningfulChars('Ab 12')).toBe(4);
    expect(countMeaningfulChars('Привет, мир')).toBe(9);
  });
});
