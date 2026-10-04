import type { QuestionDto } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { questionAnchorId, questionMarks } from './question-marks';

const E = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';

const q = (path: string, status: QuestionDto['status'] = 'open'): QuestionDto => ({
  id: path,
  path,
  type: 'missing',
  priority: 0,
  text: 'x',
  status,
  answer: null,
});

describe('questionMarks', () => {
  const marks = questionMarks([
    q(`experience.${E}.dates`),
    q('education'),
    q('contact.phone', 'dismissed'),
  ]);

  it('marks exact places and their parents, for open questions only', () => {
    expect(marks.at(`experience.${E}.dates`)).toBe(true);
    expect(marks.at(`experience.${E}`)).toBe(false);
    expect(marks.within(`experience.${E}`)).toBe(true);
    expect(marks.within('experience')).toBe(true);
    expect(marks.at('education')).toBe(true);
    expect(marks.at('contact.phone')).toBe(false);
    expect(marks.within('skills')).toBe(false);
  });

  it('builds DOM-safe anchor ids', () => {
    expect(questionAnchorId(`experience.${E}.dates`)).toBe(`cv-experience-${E}-dates`);
  });
});
