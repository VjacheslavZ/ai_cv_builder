import { describe, expect, it } from 'vitest';
import {
  buildFieldPath,
  isFieldPathWithin,
  parseFieldPath,
  type FieldPathParts,
} from './field-path.js';

const E = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';
const B = '7d9e8f00-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

describe('field paths', () => {
  const roundTrips: [string, FieldPathParts][] = [
    ['summary', { section: 'summary' }],
    ['contact', { section: 'contact' }],
    ['contact.email', { section: 'contact', field: 'email' }],
    [`contact.links.${B}`, { section: 'contact', field: 'links', itemId: B }],
    ['experience', { section: 'experience' }],
    [`experience.${E}`, { section: 'experience', entryId: E }],
    [`experience.${E}.dates`, { section: 'experience', entryId: E, field: 'dates' }],
    [`experience.${E}.bullets`, { section: 'experience', entryId: E, field: 'bullets' }],
    [
      `experience.${E}.bullets.${B}`,
      { section: 'experience', entryId: E, field: 'bullets', itemId: B },
    ],
    [`education.${E}.institution`, { section: 'education', entryId: E, field: 'institution' }],
    ['skills', { section: 'skills' }],
    [`skills.${B}`, { section: 'skills', itemId: B }],
  ];

  it.each(roundTrips)('parses and builds %s', (path, parts) => {
    expect(parseFieldPath(path)).toEqual(parts);
    expect(buildFieldPath(parts)).toBe(path);
  });

  it.each([
    '',
    'unknown',
    'summary.text',
    'experience.not-a-uuid',
    `experience.${E}.Bad-Field`,
    `experience.${E}.bullets.not-a-uuid`,
    `experience.${E}.bullets.${B}.extra`,
    'skills.python',
    `contact.email.${B}.x`,
  ])('rejects %j', (path) => {
    expect(parseFieldPath(path)).toBeNull();
  });

  it('refuses to build a field without its entry id', () => {
    expect(() => buildFieldPath({ section: 'experience', field: 'title' })).toThrow();
    expect(() => buildFieldPath({ section: 'experience', entryId: 'nope' })).toThrow();
  });

  it('checks containment by whole segments', () => {
    expect(isFieldPathWithin(`experience.${E}.bullets.${B}`, 'experience')).toBe(true);
    expect(isFieldPathWithin(`experience.${E}.bullets.${B}`, `experience.${E}.bullets`)).toBe(true);
    expect(isFieldPathWithin('summary', 'summary')).toBe(true);
    expect(isFieldPathWithin('contact.emailAlt', 'contact.email')).toBe(false);
  });
});
