import { describe, expect, it } from 'vitest';
import { answerSchema, parseDateRangeAnswer, parseSimpleAnswer } from './answer.js';

const E = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';

describe('answers (AC-8.5)', () => {
  it('rejects an empty or whitespace-only answer and trims the rest', () => {
    expect(answerSchema.safeParse({ answer: '   ' }).success).toBe(false);
    expect(answerSchema.safeParse({ answer: '' }).success).toBe(false);
    expect(answerSchema.parse({ answer: '  Led a team of 5  ' })).toEqual({
      answer: 'Led a team of 5',
    });
    expect(answerSchema.safeParse({ answer: 'x'.repeat(2_001) }).success).toBe(false);
  });
});

describe('date range answers', () => {
  it.each([
    ['2019 - 2023', { start: '2019', end: '2023' }],
    ['2019-2023', { start: '2019', end: '2023' }],
    ['2019–present', { start: '2019', end: 'present' }],
    ['03/2019 - present', { start: '2019-03', end: 'present' }],
    ['2020-01 to 2021-06', { start: '2020-01', end: '2021-06' }],
    ['2018', { start: '2018', end: '2018' }],
  ])('%s', (answer, range) => {
    expect(parseDateRangeAnswer(answer)).toEqual(range);
  });

  it.each(['March 2019 - now', '2023 - 2019', 'sometime', '2019 - 2020 - 2021'])(
    'rejects %s',
    (answer) => {
      expect(parseDateRangeAnswer(answer)).toBeNull();
    },
  );
});

describe('simple-field answers (AC-9.2)', () => {
  it('validates emails and phones', () => {
    expect(parseSimpleAnswer('contact.email', ' me@example.com ')).toEqual({
      ok: true,
      value: 'me@example.com',
    });
    expect(parseSimpleAnswer('contact.email', 'me at example')).toMatchObject({ ok: false });
    expect(parseSimpleAnswer('contact.phone', '+44 20 7946 0958')).toMatchObject({ ok: true });
    expect(parseSimpleAnswer('contact.phone', 'ring me')).toMatchObject({ ok: false });
  });

  it('writes spellings and dates as values', () => {
    expect(parseSimpleAnswer(`experience.${E}.company`, 'Yandex')).toEqual({
      ok: true,
      value: 'Yandex',
    });
    expect(parseSimpleAnswer(`experience.${E}.dates`, '2019 - present')).toEqual({
      ok: true,
      value: { start: '2019', end: 'present' },
    });
    expect(parseSimpleAnswer(`experience.${E}.dates`, 'a while ago')).toMatchObject({ ok: false });
  });

  it('refuses a path that is not a simple field', () => {
    expect(parseSimpleAnswer('summary', 'Hello')).toMatchObject({ ok: false });
  });
});
