import { emptyCvDocument, type CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { applyOps } from './apply-ops.js';

const E = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';
const B = '7d9e8f00-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const MISSING = '99999999-9999-4999-8999-999999999999';
const NEW = 'a02b1c33-4d5e-4f6a-9b7c-8d9e0f1a2b3c';

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

describe('applyOps with list ops (AC-10.2)', () => {
  it('applies ops in order: insert, then write into the new item, then move it first', () => {
    const result = applyOps(doc(), [
      { op: 'insert', path: `experience.${E}.bullets`, index: 1, value: { id: NEW, text: '' } },
      { op: 'set', path: `experience.${E}.bullets.${NEW}`, value: 'Shipped billing' },
      { op: 'move', path: `experience.${E}.bullets.${NEW}`, index: 0 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.experience[0]!.bullets).toEqual([
      { id: NEW, text: 'Shipped billing' },
      { id: B, text: 'x' },
    ]);
    expect(result.document.editedPaths).toEqual([`experience.${E}.bullets.${NEW}`]);
    expect(result.touchedPaths).toEqual([
      `experience.${E}.bullets.${NEW}`,
      `experience.${E}.bullets.${NEW}`,
    ]);
  });

  it('a write into a removed item fails the whole PATCH', () => {
    const result = applyOps(doc(), [
      { op: 'remove', path: `experience.${E}` },
      { op: 'set', path: `experience.${E}.title`, value: 'Gone' },
    ]);
    expect(result).toEqual({ ok: false, fields: { 'ops.1.path': 'This entry no longer exists' } });
  });

  it('names the failing list op and its part', () => {
    const result = applyOps(doc(), [
      { op: 'insert', path: 'skills', index: 0, value: { id: NEW, name: '' } },
      { op: 'move', path: `experience.${E}`, index: 3 },
      { op: 'remove', path: `skills.${MISSING}` },
    ]);
    expect(result).toEqual({
      ok: false,
      fields: {
        'ops.0.value': expect.any(String),
        'ops.1.index': 'This position is outside the list',
        'ops.2.path': 'This item no longer exists',
      },
    });
  });

  it('rejects a list past its limit', () => {
    const d = doc();
    d.skills = Array.from({ length: 100 }, (_, i) => ({
      id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      name: `Skill ${i}`,
    }));
    const result = applyOps(d, [
      { op: 'insert', path: 'skills', index: 0, value: { id: NEW, name: 'One more' } },
    ]);
    expect(result).toEqual({ ok: false, fields: { ops: 'The CV would become invalid' } });
  });
});
