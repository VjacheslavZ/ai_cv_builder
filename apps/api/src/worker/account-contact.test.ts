import { emptyCvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import type { GroundingResult } from '../grounding/ground-cv.js';
import { question } from '../grounding/questions.js';
import { withAccountContact } from './account-contact.js';

const ACCOUNT = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };

function grounded(contact: { name?: string; email?: string } = {}): GroundingResult {
  const document = emptyCvDocument();
  document.contact = { ...document.contact, ...contact };
  return {
    document,
    removed: [],
    questions: [
      question('contact.name', 'missing', 'What is your full name?'),
      question('contact.email', 'unverified', 'What email should employers use?'),
      question('contact.phone', 'missing', 'What phone number should be on your CV?'),
    ],
    summaryRoleClaim: false,
  };
}

describe('withAccountContact', () => {
  it('fills a missing name and email from the account and drops their questions', () => {
    const result = withAccountContact(grounded(), ACCOUNT);
    expect(result.document.contact).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    expect(result.questions.map((q) => q.path)).toEqual(['contact.phone']);
  });

  it('keeps the name and email the sources give', () => {
    const input = grounded({ name: 'Augusta King', email: 'augusta@example.org' });
    const result = withAccountContact(input, ACCOUNT);
    expect(result.document.contact).toMatchObject({
      name: 'Augusta King',
      email: 'augusta@example.org',
    });
    expect(result).toBe(input);
  });

  it('fills only the field the sources lack', () => {
    const result = withAccountContact(grounded({ name: 'Augusta King' }), ACCOUNT);
    expect(result.document.contact).toMatchObject({
      name: 'Augusta King',
      email: 'ada@example.com',
    });
    expect(result.questions.map((q) => q.path)).toEqual(['contact.name', 'contact.phone']);
  });

  it('leaves the name empty for an account without one (created before the fields existed)', () => {
    const result = withAccountContact(grounded(), { ...ACCOUNT, firstName: '', lastName: ' ' });
    expect(result.document.contact.name).toBe('');
    expect(result.questions.map((q) => q.path)).toContain('contact.name');
  });
});
