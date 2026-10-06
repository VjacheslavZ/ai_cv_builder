import { fieldValueSchema } from '@cv/shared';
import type { GroundingResult } from '../grounding/ground-cv.js';

/** What the user entered on sign-up. */
export interface AccountContact {
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Fills the contact name and email the sources do not give from the user's account. A grounded
 * value from the sources always wins (an uploaded CV may use another name or email); a filled
 * field drops its questions, which would otherwise ask for what the account already says.
 * Account data is the user's own, so it needs no grounding.
 */
export function withAccountContact(
  result: GroundingResult,
  account: AccountContact,
): GroundingResult {
  const fallback = {
    name: `${account.firstName.trim()} ${account.lastName.trim()}`.trim(),
    email: account.email.trim(),
  };
  const contact = { ...result.document.contact };
  const filled = new Set<string>();
  for (const field of ['name', 'email'] as const) {
    const value = fallback[field];
    if (contact[field] !== '' || value === '') continue;
    if (!fieldValueSchema(`contact.${field}`)?.safeParse(value).success) continue;
    contact[field] = value;
    filled.add(`contact.${field}`);
  }
  if (filled.size === 0) return result;
  return {
    ...result,
    document: { ...result.document, contact },
    questions: result.questions.filter((q) => !filled.has(q.path)),
  };
}
