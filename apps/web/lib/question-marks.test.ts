import { describe, expect, it } from 'vitest';
import { questionAnchorId } from './question-marks';

const E = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';

describe('questionAnchorId', () => {
  it('builds DOM-safe anchor ids', () => {
    expect(questionAnchorId(`experience.${E}.dates`)).toBe(`cv-experience-${E}-dates`);
  });
});
