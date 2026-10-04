import { z } from 'zod';
import { parseFieldPath } from '../field-path/field-path.js';
import { cvDateRangeSchema, SHORT_TEXT_MAX_LENGTH, type CvDateRange } from '../cv/document.js';
import { cvEmailSchema, cvPhoneSchema, isSimpleField } from '../cv/fields.js';

export const ANSWER_MAX_LENGTH = 2_000;

/** `POST /api/cvs/:id/questions/:qid/answer` (AC-8.5): trimmed, not empty. */
export const answerSchema = z.object({
  answer: z
    .string()
    .trim()
    .min(1, 'Write an answer or skip the question')
    .max(ANSWER_MAX_LENGTH, `Use at most ${ANSWER_MAX_LENGTH.toLocaleString('en-US')} characters`),
});
export type AnswerInput = z.infer<typeof answerSchema>;

/**
 * `200`: a simple field was written directly (AC-9.2). `202`: an `apply_answer` job rewrites the
 * section (AC-9.1); the question is `applying` until it finishes.
 */
export type AnswerResponse =
  { status: 'answered'; version: number } | { status: 'applying'; jobId: string };

const MONTH_YEAR = /^(0?[1-9]|1[0-2])\/(\d{4})$/;
const DATE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
const PRESENT = /^(present|now|current|today)$/i;

function parseDate(text: string): string | null {
  const t = text.trim();
  if (DATE.test(t)) return t;
  const m = MONTH_YEAR.exec(t);
  return m ? `${m[2]}-${m[1]!.padStart(2, '0')}` : null;
}

/**
 * "2019 - 2023", "03/2019 – present", "2020-01 to 2021-06", or one date for both ends. Months as
 * numbers only: the answer is a value, not prose.
 */
export function parseDateRangeAnswer(answer: string): CvDateRange | null {
  // "2019-2023" is a range, not a month: give the dash spaces before splitting.
  const spaced = answer.trim().replace(/^(\d{4})-(\d{4}|present)$/i, '$1 - $2');
  const [from, to, ...rest] = spaced.split(/\s+to\s+|\s*[–—]\s*|\s+-\s+/i);
  if (!from || rest.length > 0) return null;
  const start = parseDate(from);
  const end = to === undefined ? start : PRESENT.test(to.trim()) ? 'present' : parseDate(to);
  if (!start || !end) return null;
  const range = cvDateRangeSchema.safeParse({ start, end });
  return range.success ? range.data : null;
}

export type SimpleAnswerResult = { ok: true; value: unknown } | { ok: false; message: string };

/** The value a simple-field answer writes (AC-9.2), or why the format is wrong (`400`). */
export function parseSimpleAnswer(path: string, answer: string): SimpleAnswerResult {
  const parts = parseFieldPath(path);
  if (!parts || !isSimpleField(path)) return { ok: false, message: 'Not a simple field' };
  const text = answer.trim();
  if ('field' in parts && parts.field === 'dates') {
    const range = parseDateRangeAnswer(text);
    return range
      ? { ok: true, value: range }
      : { ok: false, message: 'Use dates like "2019 - 2023" or "03/2019 - present"' };
  }
  const schema =
    parts.section === 'contact' && parts.field === 'email'
      ? cvEmailSchema
      : parts.section === 'contact' && parts.field === 'phone'
        ? cvPhoneSchema
        : z.string().max(SHORT_TEXT_MAX_LENGTH, 'This is too long for this field');
  const parsed = schema.safeParse(text);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid value' };
}
