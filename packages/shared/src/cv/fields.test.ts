import { describe, expect, it } from 'vitest';
import { emptyCvDocument, type CvDocument } from './document.js';
import {
  applyScopeFor,
  fieldValueSchema,
  getField,
  isEditableField,
  isSimpleField,
  setField,
} from './fields.js';
import { patchCvSchema } from './patch.js';

const E = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';
const B = '7d9e8f00-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const L = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const MISSING = '99999999-9999-4999-8999-999999999999';

function doc(): CvDocument {
  return {
    ...emptyCvDocument(),
    contact: {
      name: 'Ada',
      email: 'ada@example.com',
      phone: '',
      city: '',
      links: [{ id: L, label: 'GitHub', url: 'https://github.com/ada' }],
    },
    experience: [
      {
        id: E,
        company: 'Acme',
        title: 'Engineer',
        dates: null,
        bullets: [{ id: B, text: 'Built APIs' }],
      },
    ],
    skills: [{ id: B, name: 'SQL' }],
  };
}

describe('editable fields', () => {
  it.each([
    'summary',
    'contact.email',
    `contact.links.${L}`,
    `experience.${E}.title`,
    `experience.${E}.dates`,
    `experience.${E}.bullets.${B}`,
    `education.${E}.degree`,
    `skills.${B}`,
  ])('%s is editable', (path) => {
    expect(isEditableField(path)).toBe(true);
  });

  it.each([
    'contact',
    'contact.links',
    'experience',
    `experience.${E}`,
    `experience.${E}.bullets`,
    `experience.${E}.institution`,
    `education.${E}.bullets.${B}`,
    'skills',
    'contact.website',
  ])('%s is not an editable field', (path) => {
    expect(isEditableField(path)).toBe(false);
  });

  it('reads and writes through the same paths', () => {
    const d = doc();
    expect(getField(d, `experience.${E}.bullets.${B}`)).toBe('Built APIs');
    expect(setField(d, `experience.${E}.bullets.${B}`, 'Built REST APIs')).toBe(true);
    expect(d.experience[0]!.bullets[0]!.text).toBe('Built REST APIs');
    expect(setField(d, `contact.links.${L}`, { label: 'Site', url: 'https://ada.dev' })).toBe(true);
    expect(getField(d, `contact.links.${L}`)).toEqual({ label: 'Site', url: 'https://ada.dev' });
    expect(setField(d, `experience.${E}.dates`, { start: '2020', end: 'present' })).toBe(true);
    expect(getField(d, `experience.${E}.dates`)).toEqual({ start: '2020', end: 'present' });
  });

  it('refuses entries and items that do not exist', () => {
    const d = doc();
    expect(getField(d, `experience.${MISSING}.title`)).toBeUndefined();
    expect(setField(d, `experience.${MISSING}.title`, 'x')).toBe(false);
    expect(setField(d, `experience.${E}.bullets.${MISSING}`, 'x')).toBe(false);
    expect(setField(d, 'experience', [])).toBe(false);
  });
});

describe('field values (AC-10.6)', () => {
  const valid = (path: string, value: unknown) => fieldValueSchema(path)!.safeParse(value).success;

  it('caps bullets at 500 characters', () => {
    expect(valid(`experience.${E}.bullets.${B}`, 'x'.repeat(500))).toBe(true);
    expect(valid(`experience.${E}.bullets.${B}`, 'x'.repeat(501))).toBe(false);
  });

  it('allows only http(s) and mailto links', () => {
    const path = `contact.links.${L}`;
    expect(valid(path, { label: 'a', url: 'https://example.com' })).toBe(true);
    expect(valid(path, { label: 'a', url: 'mailto:a@example.com' })).toBe(true);
    expect(valid(path, { label: 'a', url: 'javascript:alert(1)' })).toBe(false);
    expect(valid(path, { label: 'a', url: 'not a url' })).toBe(false);
  });

  it('checks email, phone, and date formats, allowing an empty value', () => {
    expect(valid('contact.email', 'me@example.com')).toBe(true);
    expect(valid('contact.email', '')).toBe(true);
    expect(valid('contact.email', 'not-an-email')).toBe(false);
    expect(valid('contact.phone', '+1 (555) 010-2030')).toBe(true);
    expect(valid('contact.phone', 'call me')).toBe(false);
    expect(valid(`experience.${E}.dates`, { start: '2019-03', end: 'present' })).toBe(true);
    expect(valid(`experience.${E}.dates`, null)).toBe(true);
    expect(valid(`experience.${E}.dates`, { start: '2021', end: '2019' })).toBe(false);
    expect(valid(`experience.${E}.dates`, { start: 'March 2019', end: 'present' })).toBe(false);
  });

  it('validates the PATCH envelope', () => {
    const op = { op: 'set', path: 'summary', value: 'Hi' };
    expect(patchCvSchema.safeParse({ baseVersion: 3, ops: [op] }).success).toBe(true);
    expect(patchCvSchema.safeParse({ baseVersion: 3, ops: [] }).success).toBe(false);
    expect(patchCvSchema.safeParse({ baseVersion: -1, ops: [op] }).success).toBe(false);
    expect(
      patchCvSchema.safeParse({ baseVersion: 1, ops: [{ ...op, op: 'rename' }] }).success,
    ).toBe(false);
    // List ops (AC-10.2): `insert` and `move` need a position.
    expect(
      patchCvSchema.safeParse({ baseVersion: 1, ops: [{ op: 'remove', path: 'skills' }] }).success,
    ).toBe(true);
    expect(
      patchCvSchema.safeParse({ baseVersion: 1, ops: [{ op: 'move', path: 'skills' }] }).success,
    ).toBe(false);
    expect(
      patchCvSchema.safeParse({
        baseVersion: 1,
        ops: [{ op: 'insert', path: 'skills', index: -1, value: {} }],
      }).success,
    ).toBe(false);
    expect(
      patchCvSchema.safeParse({ baseVersion: 1, ops: [{ ...op, path: 'nope' }] }).success,
    ).toBe(false);
  });
});

describe('simple fields and apply scopes (AC-9.1, AC-9.2)', () => {
  it.each([
    ['contact.email', true],
    ['contact.name', true],
    [`experience.${E}.dates`, true],
    [`experience.${E}.company`, true],
    [`education.${E}.institution`, true],
    [`education.${E}.dates`, true],
    [`experience.${E}.title`, false],
    [`experience.${E}.bullets`, false],
    ['contact.links', false],
    ['summary', false],
    ['skills', false],
  ])('isSimpleField(%s) = %s', (path, simple) => {
    expect(isSimpleField(path)).toBe(simple);
  });

  it('rewrites one entry for anything inside it, otherwise the section', () => {
    expect(applyScopeFor(`experience.${E}.bullets`)).toBe(`experience.${E}`);
    expect(applyScopeFor(`experience.${E}.bullets.${B}`)).toBe(`experience.${E}`);
    expect(applyScopeFor('experience')).toBe('experience');
    expect(applyScopeFor(`skills.${B}`)).toBe('skills');
    expect(applyScopeFor('contact.links')).toBe('contact');
    expect(applyScopeFor('summary')).toBe('summary');
    expect(applyScopeFor('bad')).toBeNull();
  });
});
