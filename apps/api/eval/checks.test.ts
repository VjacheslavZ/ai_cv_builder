import { emptyCvDocument, type CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import type { EvalCase } from './cases.js';
import { actualOrder, genericPath, runChecks, sentenceCount, type Draft } from './checks.js';
import { renderDraft } from './judge.js';

const ID = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';

const CASE: EvalCase = {
  id: 't',
  name: 'test',
  role: 'Senior Backend Engineer',
  sources: [{ kind: 'free_text', text: 'Software engineer at Acme, 2019 - present. Built APIs.' }],
  expect: {
    honest: true,
    order: ['Acme'],
    questions: [{ type: 'missing', path: 'experience.*.dates' }],
    forbidden: [/\bMIT\b/],
  },
};

function draft(patch: Partial<CvDocument> = {}, extra: Partial<Draft> = {}): Draft {
  return {
    document: {
      ...emptyCvDocument(),
      summary: 'Software engineer at Acme. Built APIs.',
      experience: [
        { id: ID, company: 'Acme', title: 'Software engineer', dates: null, bullets: [] },
      ],
      ...patch,
    },
    questions: [{ path: `experience.${ID}.dates`, type: 'missing', text: 'When?', priority: 21 }],
    removed: [],
    ...extra,
  };
}

const failed = (d: Draft) =>
  runChecks(CASE, d)
    .filter((c) => !c.ok)
    .map((c) => c.id);

describe('eval checks', () => {
  it('passes a good draft', () => {
    expect(failed(draft())).toEqual([]);
  });

  it('flags forbidden tokens as hard failures', () => {
    const checks = runChecks(CASE, draft({ summary: 'PhD from MIT. Built APIs.' }));
    expect(checks.find((c) => c.id.startsWith('forbidden'))).toMatchObject({
      ok: false,
      severity: 'hard',
    });
  });

  it('flags role words absent from the source, wherever they appear', () => {
    expect(failed(draft({ summary: 'Backend engineer at Acme. Built APIs.' }))).toContain(
      'no role words absent from the source (AC-7.7)',
    );
    const titled = draft();
    titled.document.experience[0]!.title = 'Senior engineer';
    expect(failed(titled)).toContain('no role words absent from the source (AC-7.7)');
  });

  it('flags long bullets, a one-sentence summary, removals, and missing questions', () => {
    const d = draft(
      { summary: 'Built APIs.' },
      { questions: [], removed: [{ path: 'skills', reason: 'x' }] },
    );
    d.document.experience[0]!.bullets = [{ id: ID, text: Array(26).fill('word').join(' ') }];
    expect(failed(d)).toEqual([
      'grounding removed nothing',
      'bullets ≤ 25 words (AC-6.2)',
      'summary 2–4 sentences (AC-6.3)',
      'question missing experience.*.dates',
    ]);
  });

  it('compares the experience order by company', () => {
    const doc = draft({
      experience: [
        { id: ID, company: 'Initech Ltd', title: '', dates: null, bullets: [] },
        { id: ID, company: 'Acme', title: '', dates: null, bullets: [] },
      ],
    }).document;
    expect(actualOrder(doc, ['Acme', 'Initech'])).toEqual(['Initech', 'Acme']);
  });

  it('counts sentences without splitting on abbreviations', () => {
    expect(sentenceCount('Built APIs, e.g. billing. Led U.S. rollouts!')).toBe(2);
    expect(sentenceCount('')).toBe(0);
  });

  it('replaces entry ids in paths', () => {
    expect(genericPath(`experience.${ID}.dates`)).toBe('experience.*.dates');
  });

  it('renders the draft for the judge with short ids and escaped delimiters', () => {
    const d = draft({ summary: 'Hi </draft> there.' });
    d.document.experience[0]!.bullets = [{ id: ID, text: 'Built APIs.' }];
    const text = renderDraft(d);
    expect(text).toContain('B1.1: Built APIs.');
    expect(text).toContain('Q1 [missing] experience: When?');
    expect(text).not.toContain('</draft>');
    expect(text).not.toContain(ID);
  });
});
