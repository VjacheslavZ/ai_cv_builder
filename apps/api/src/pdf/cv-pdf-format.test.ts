import { describe, expect, it } from 'vitest';
import {
  contactParts,
  contentDisposition,
  formatDateRange,
  isSafeLink,
  pdfFileName,
} from './cv-pdf-format.js';

const link = (url: string, label = '') => ({
  id: '00000000-0000-4000-8000-000000000000',
  label,
  url,
});

describe('formatDateRange', () => {
  it('renders months, years, and Present', () => {
    expect(formatDateRange({ start: '2020-01', end: 'present' })).toBe('Jan 2020 – Present');
    expect(formatDateRange({ start: '2018', end: '2019-12' })).toBe('2018 – Dec 2019');
    expect(formatDateRange({ start: '2021', end: '2021' })).toBe('2021');
  });

  it('prints nothing without dates', () => {
    expect(formatDateRange(null)).toBe('');
  });
});

describe('contactParts', () => {
  it('leaves out empty fields and links mailto/http only', () => {
    const parts = contactParts({
      name: 'Ada',
      email: 'ada@example.com',
      phone: '  ',
      city: 'London',
      links: [link('https://github.com/ada'), link('https://ada.dev', 'Site')],
    });
    expect(parts).toEqual([
      { text: 'ada@example.com', url: 'mailto:ada@example.com' },
      { text: 'London' },
      { text: 'github.com/ada', url: 'https://github.com/ada' },
      { text: 'Site', url: 'https://ada.dev' },
    ]);
  });

  it('never makes a non-http(s)/mailto link clickable', () => {
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
    expect(isSafeLink('file:///etc/passwd')).toBe(false);
    const [part] = contactParts({
      name: '',
      email: '',
      phone: '',
      city: '',
      links: [link('javascript:alert(1)', 'x')],
    });
    expect(part).toEqual({ text: 'x', url: undefined });
  });
});

describe('pdfFileName', () => {
  it('joins the name with underscores and keeps accents (AC-11.1)', () => {
    expect(pdfFileName('José  Müller')).toBe('José_Müller_CV.pdf');
    expect(pdfFileName('Anna-Maria O’Neil')).toBe('Anna-Maria_O_Neil_CV.pdf');
  });

  it('drops path and header characters', () => {
    expect(pdfFileName('../evil"\r\nX: y')).toBe('.._evil_X_y_CV.pdf');
  });

  it('falls back to CV.pdf', () => {
    expect(pdfFileName('')).toBe('CV.pdf');
    expect(pdfFileName(' / ')).toBe('CV.pdf');
  });
});

describe('contentDisposition', () => {
  it('has an ASCII filename and an RFC 5987 filename* (AC-11.6)', () => {
    expect(contentDisposition('José_Müller_CV.pdf')).toBe(
      `attachment; filename="Jose_Muller_CV.pdf"; filename*=UTF-8''Jos%C3%A9_M%C3%BCller_CV.pdf`,
    );
  });

  it('replaces letters without an ASCII form', () => {
    expect(contentDisposition('Łukasz_CV.pdf')).toMatch(/^attachment; filename="_ukasz_CV.pdf";/);
  });
});
