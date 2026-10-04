import { OPEN_QUESTIONS_MAX, type CvDocument } from '@cv/shared';
import type { DraftQuestion } from '../src/grounding/questions.js';
import { roleClaims } from '../src/grounding/role.js';
import { groundingSource } from '../src/grounding/source.js';
import type { EvalCase, ExpectedQuestion } from './cases.js';

// Deterministic checks of one generated draft: free, reproducible, no judgement needed.
// `hard` checks are invariants and fail the case; `soft` ones are quality signals for the report.

export interface CheckResult {
  id: string;
  severity: 'hard' | 'soft';
  ok: boolean;
  /** Counts and names only: shown in the report. */
  detail?: string;
}

export interface Draft {
  document: CvDocument;
  questions: DraftQuestion[];
  removed: { path: string; reason: string }[];
}

const BULLET_MAX_WORDS = 25;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Sentences of a summary; abbreviations like "e.g." and "B.Sc." do not end one. */
export function sentenceCount(text: string): number {
  const masked = text.replace(/\b(?:e\.g|i\.e|etc|vs|approx|[A-Z](?:\.[A-Z])+)\./g, (m) =>
    m.replace(/\./g, '·'),
  );
  return masked.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length;
}

/** `experience.<uuid>.dates` → `experience.*.dates`. */
export const genericPath = (path: string) => path.replace(UUID, '*');

const matches = (q: DraftQuestion, e: ExpectedQuestion) =>
  q.type === e.type && genericPath(q.path) === e.path;

/** The companies of `expected` in the order the draft lists them (case-insensitive). */
export function actualOrder(document: CvDocument, expected: string[]): string[] {
  return document.experience
    .map((e) => expected.find((name) => e.company.toLowerCase().includes(name.toLowerCase())))
    .filter((name): name is string => name !== undefined);
}

export function runChecks(c: EvalCase, draft: Draft): CheckResult[] {
  const { document, questions, removed } = draft;
  const checks: CheckResult[] = [];
  const add = (id: string, severity: CheckResult['severity'], ok: boolean, detail?: string) =>
    checks.push({ id, severity, ok, ...(detail ? { detail } : {}) });

  const text = JSON.stringify(document);
  for (const re of c.expect.forbidden ?? []) add(`forbidden ${re}`, 'hard', !re.test(text));
  add(
    'questions ≤ 10 (AC-8.2)',
    'hard',
    questions.length <= OPEN_QUESTIONS_MAX,
    `${questions.length}`,
  );

  if (c.expect.honest) {
    add(
      'grounding removed nothing',
      'soft',
      removed.length === 0,
      removed.map((r) => `${genericPath(r.path)}: ${r.reason}`).join(', '),
    );
  }

  const bullets = document.experience.flatMap((e) => e.bullets.map((b) => b.text));
  const long = bullets.filter((b) => wordCount(b) > BULLET_MAX_WORDS).length;
  add(
    `bullets ≤ ${BULLET_MAX_WORDS} words (AC-6.2)`,
    'soft',
    long === 0,
    `${long}/${bullets.length} long`,
  );

  const sentences = sentenceCount(document.summary);
  add(
    'summary 2–4 sentences (AC-6.3)',
    'soft',
    sentences >= 2 && sentences <= 4,
    document.summary ? `${sentences}` : 'empty',
  );

  // AC-7.7: role words absent from the source must not describe the person anywhere.
  const source = groundingSource(c.sources.map((s) => s.text));
  const claimed = new Set(
    [document.summary, ...document.experience.map((e) => e.title), ...bullets].flatMap((t) =>
      roleClaims(t, c.role, source),
    ),
  );
  add(
    'no role words absent from the source (AC-7.7)',
    'soft',
    claimed.size === 0,
    [...claimed].join(', '),
  );

  if (c.expect.order) {
    const order = actualOrder(document, c.expect.order);
    add(
      'experience order (AC-6.4)',
      'soft',
      order.join('|') === c.expect.order.join('|'),
      order.join(' > ') || 'none found',
    );
  }

  for (const e of c.expect.questions ?? []) {
    add(
      `question ${e.type} ${e.path}`,
      'soft',
      questions.some((q) => matches(q, e)),
    );
  }
  return checks;
}
