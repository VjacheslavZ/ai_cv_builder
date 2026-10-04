import { emptyCvDocument, type CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { addEditedPaths, applyOps } from './apply-ops.js';

const E = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';
const B = '7d9e8f00-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const MISSING = '99999999-9999-4999-8999-999999999999';

function doc(): CvDocument {
  return {
    ...emptyCvDocument(),
    experience: [
      { id: E, company: 'Acme', title: 'Engineer', dates: null, bullets: [{ id: B, text: 'x' }] },
    ],
  };
}

describe('applyOps (AC-10.1, AC-10.6)', () => {
  it('writes values and marks each path as edited by hand', () => {
    const before = doc();
    const result = applyOps(before, [
      { op: 'set', path: `experience.${E}.bullets.${B}`, value: 'Led a team of 5 engineers' },
      { op: 'set', path: 'summary', value: '  Engineer.  ' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.experience[0]!.bullets[0]!.text).toBe('Led a team of 5 engineers');
    expect(result.document.summary).toBe('Engineer.');
    expect(result.document.editedPaths).toEqual([`experience.${E}.bullets.${B}`, 'summary']);
    expect(before.summary).toBe(''); // the input is not mutated
  });

  it('rejects the whole PATCH when any op is invalid, naming the op', () => {
    const result = applyOps(doc(), [
      { op: 'set', path: 'summary', value: 'fine' },
      { op: 'set', path: `experience.${E}.bullets.${B}`, value: 'x'.repeat(501) },
      { op: 'set', path: `experience.${MISSING}.title`, value: 'Ghost' },
      { op: 'set', path: 'experience', value: [] },
    ]);
    expect(result).toEqual({
      ok: false,
      fields: {
        'ops.1.value': expect.any(String),
        'ops.2.path': 'This entry no longer exists',
        'ops.3.path': 'This field cannot be edited',
      },
    });
  });

  it('rejects a javascript: link', () => {
    const d = doc();
    d.contact.links = [{ id: B, label: 'Site', url: 'https://ada.dev' }];
    const result = applyOps(d, [
      { op: 'set', path: `contact.links.${B}`, value: { label: 'x', url: 'javascript:alert(1)' } },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('addEditedPaths', () => {
  it('skips duplicates and paths already covered', () => {
    expect(addEditedPaths(['summary'], ['summary', 'contact.email'])).toEqual([
      'summary',
      'contact.email',
    ]);
    expect(addEditedPaths([`experience.${E}`], [`experience.${E}.title`])).toEqual([
      `experience.${E}`,
    ]);
  });
});
