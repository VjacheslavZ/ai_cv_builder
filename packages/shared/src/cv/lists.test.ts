import { describe, expect, it } from 'vitest';
import { emptyCvDocument, type CvDocument } from './document.js';
import {
  addEditedPaths,
  applyListOp,
  isRemovedItem,
  parseItemPath,
  parseListPath,
  removedKey,
} from './lists.js';

const E = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';
const F = '1c7d2a6f-5d2b-4e3c-8b88-2a3f4e5d6c7b';
const B1 = '7d9e8f00-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const B2 = '8e0f9a11-2b3c-4d4e-9f5a-6b7c8d9e0f1a';
const S1 = '9f1a0b22-3c4d-4e5f-8a6b-7c8d9e0f1a2b';
const NEW = 'a02b1c33-4d5e-4f6a-9b7c-8d9e0f1a2b3c';

function doc(): CvDocument {
  return {
    ...emptyCvDocument(),
    experience: [
      {
        id: E,
        company: 'Acme',
        title: 'Engineer',
        dates: null,
        bullets: [
          { id: B1, text: 'Cut latency by 75%' },
          { id: B2, text: 'Mentored 3 juniors' },
        ],
      },
      { id: F, company: 'Globex', title: 'Intern', dates: null, bullets: [] },
    ],
    skills: [{ id: S1, name: 'TypeScript' }],
  };
}

describe('list paths', () => {
  it('knows the lists and their items', () => {
    expect(parseListPath('experience')).toEqual({ kind: 'experience' });
    expect(parseListPath(`experience.${E}.bullets`)).toEqual({ kind: 'bullets', entryId: E });
    expect(parseListPath('skills')).toEqual({ kind: 'skills' });
    expect(parseListPath('contact.links')).toBeNull();
    expect(parseListPath(`experience.${E}`)).toBeNull();
    expect(parseItemPath(`experience.${E}.bullets.${B1}`)).toEqual({
      list: `experience.${E}.bullets`,
      itemId: B1,
    });
    expect(parseItemPath(`skills.${S1}`)).toEqual({ list: 'skills', itemId: S1 });
    expect(parseItemPath(`experience.${E}.title`)).toBeNull();
    expect(parseItemPath(`contact.links.${S1}`)).toBeNull();
  });

  it('keys removed items by their normalized text', () => {
    expect(removedKey(`experience.${E}.bullets`, { text: ' Mentored 3 Juniors.' })).toBe(
      'mentored 3 juniors',
    );
    expect(removedKey('experience', { company: 'Acme', title: 'Engineer' })).toBe('acme engineer');
    expect(removedKey('skills', { name: '' })).toBe('');
  });
});

describe('applyListOp', () => {
  it('inserts a new item, which becomes a manual edit', () => {
    const d = doc();
    const result = applyListOp(d, {
      op: 'insert',
      path: `experience.${E}.bullets`,
      index: 1,
      value: { id: NEW, text: '' },
    });
    expect(result).toEqual({ ok: true, touched: `experience.${E}.bullets.${NEW}` });
    expect(d.experience[0]!.bullets.map((b) => b.id)).toEqual([B1, NEW, B2]);
    expect(d.editedPaths).toEqual([`experience.${E}.bullets.${NEW}`]);
  });

  it('marks every field of a new entry, its bullets included', () => {
    const d = doc();
    const bullet = 'b13c2d44-5e6f-4a7b-8c8d-9e0f1a2b3c4d';
    const entry = {
      id: NEW,
      company: '',
      title: '',
      dates: null,
      bullets: [{ id: bullet, text: '' }],
    };
    expect(applyListOp(d, { op: 'insert', path: 'experience', index: 2, value: entry }).ok).toBe(
      true,
    );
    expect(d.editedPaths).toEqual([
      `experience.${NEW}.company`,
      `experience.${NEW}.title`,
      `experience.${NEW}.dates`,
      `experience.${NEW}.bullets.${bullet}`,
    ]);
  });

  it('refuses an invalid item, a used id, a missing list, or a position past the end', () => {
    const cases = [
      [{ path: 'skills', index: 0, value: { id: NEW, name: '' } }, 'value'],
      [{ path: 'skills', index: 0, value: { id: B1, name: 'Go' } }, 'value'],
      [{ path: `experience.${NEW}.bullets`, index: 0, value: { id: NEW, text: '' } }, 'path'],
      [{ path: 'contact.links', index: 0, value: { id: NEW } }, 'path'],
      [{ path: 'skills', index: 5, value: { id: NEW, name: 'Go' } }, 'index'],
    ] as const;
    for (const [op, field] of cases) {
      const d = doc();
      expect(applyListOp(d, { op: 'insert', ...op })).toMatchObject({ ok: false, field });
      expect(d).toEqual(doc());
    }
  });

  it('removes an item, forgets its manual edits, and remembers it', () => {
    const d = doc();
    d.editedPaths = [`experience.${E}.title`, `experience.${F}.title`];
    expect(applyListOp(d, { op: 'remove', path: `experience.${E}` })).toEqual({
      ok: true,
      touched: `experience.${E}`,
    });
    expect(d.experience.map((e) => e.id)).toEqual([F]);
    expect(d.editedPaths).toEqual([`experience.${F}.title`]);
    expect(d.removed).toEqual([{ list: 'experience', key: 'acme engineer' }]);
    expect(isRemovedItem(d, 'experience', { company: 'ACME', title: 'Engineer' })).toBe(true);
    expect(isRemovedItem(d, 'education', { institution: 'Acme', degree: 'Engineer' })).toBe(false);
  });

  it('adding the same item again forgets the removal', () => {
    const d = doc();
    applyListOp(d, { op: 'remove', path: `skills.${S1}` });
    expect(isRemovedItem(d, 'skills', { name: 'TypeScript' })).toBe(true);
    applyListOp(d, {
      op: 'insert',
      path: 'skills',
      index: 0,
      value: { id: S1, name: 'TypeScript' },
    });
    expect(isRemovedItem(d, 'skills', { name: 'TypeScript' })).toBe(false);
  });

  it('moves an item and pins it as a manual edit', () => {
    const d = doc();
    expect(applyListOp(d, { op: 'move', path: `experience.${E}.bullets.${B2}`, index: 0 })).toEqual(
      { ok: true, touched: null },
    );
    expect(d.experience[0]!.bullets.map((b) => b.id)).toEqual([B2, B1]);
    expect(d.editedPaths).toEqual([`experience.${E}.bullets.${B2}`]);

    expect(applyListOp(d, { op: 'move', path: `experience.${F}`, index: 0 }).ok).toBe(true);
    expect(d.experience.map((e) => e.id)).toEqual([F, E]);
    // The entry's own fields, not its bullets.
    expect(d.editedPaths).toContain(`experience.${F}.company`);
  });

  it('refuses to move or remove what is gone, or to move past the end', () => {
    const d = doc();
    expect(applyListOp(d, { op: 'remove', path: `skills.${NEW}` })).toMatchObject({
      ok: false,
      field: 'path',
    });
    expect(applyListOp(d, { op: 'move', path: `skills.${S1}`, index: 1 })).toMatchObject({
      ok: false,
      field: 'index',
    });
    expect(applyListOp(d, { op: 'remove', path: `experience.${E}.title` })).toMatchObject({
      ok: false,
    });
    expect(d).toEqual(doc());
  });
});

describe('addEditedPaths', () => {
  it('adds new paths once and skips paths inside an edited one', () => {
    expect(addEditedPaths(['summary'], ['summary', 'contact.email'])).toEqual([
      'summary',
      'contact.email',
    ]);
    expect(addEditedPaths([`experience.${E}`], [`experience.${E}.title`])).toEqual([
      `experience.${E}`,
    ]);
  });
});
