import { emptyCvDocument, type CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { questionLocation } from './question-location';

const JOB = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';
const BLANK_JOB = '1c7d2a6f-5d2b-4e3c-8b88-2a3f4e5d6c7b';
const BULLET = '00000000-0000-4000-8000-000000000001';
const SCHOOL = '00000000-0000-4000-8000-000000000002';
const SKILL = '00000000-0000-4000-8000-000000000003';
const LINK = '00000000-0000-4000-8000-000000000004';
const GONE = '00000000-0000-4000-8000-0000000000ff';

const doc: CvDocument = {
  ...emptyCvDocument(),
  contact: {
    ...emptyCvDocument().contact,
    links: [{ id: LINK, label: 'GitHub', url: 'https://github.com/ada' }],
  },
  experience: [
    {
      id: JOB,
      company: 'Acme Corp',
      title: 'Engineer',
      dates: null,
      bullets: [{ id: BULLET, text: 'Shipped it' }],
    },
    { id: BLANK_JOB, company: ' ', title: '', dates: null, bullets: [] },
  ],
  education: [{ id: SCHOOL, institution: 'MIT', degree: '', dates: null }],
  skills: [{ id: SKILL, name: 'Redis' }],
};

describe('questionLocation', () => {
  it.each([
    ['summary', ['Summary']],
    ['contact.phone', ['Contact', 'Phone']],
    [`contact.links.${LINK}`, ['Contact', 'Links', 'GitHub']],
    ['experience', ['Experience']],
    [`experience.${JOB}`, ['Experience', 'Acme Corp — Engineer']],
    [`experience.${JOB}.dates`, ['Experience', 'Acme Corp — Engineer', 'Dates']],
    [`experience.${JOB}.bullets`, ['Experience', 'Acme Corp — Engineer', 'Achievements']],
    [
      `experience.${JOB}.bullets.${BULLET}`,
      ['Experience', 'Acme Corp — Engineer', 'Achievement 1'],
    ],
    [`experience.${BLANK_JOB}.title`, ['Experience', 'Job 2', 'Job title']],
    [`education.${SCHOOL}.dates`, ['Education', 'MIT', 'Dates']],
    [`skills.${SKILL}`, ['Skills', 'Redis']],
  ])('%s', (path, steps) => {
    expect(questionLocation(path, doc)).toEqual(steps);
  });

  it('leaves out entries and items that are gone', () => {
    expect(questionLocation(`experience.${GONE}.dates`, doc)).toEqual(['Experience']);
    expect(questionLocation(`skills.${GONE}`, doc)).toEqual(['Skills']);
    expect(questionLocation(`experience.${JOB}.bullets.${GONE}`, doc)).toEqual([
      'Experience',
      'Acme Corp — Engineer',
      'Achievements',
    ]);
  });

  it('names only the section when the document part is not there', () => {
    expect(questionLocation(`experience.${JOB}.dates`, {})).toEqual(['Experience']);
  });

  it('is empty for an invalid path', () => {
    expect(questionLocation('nope.1', doc)).toEqual([]);
  });
});
