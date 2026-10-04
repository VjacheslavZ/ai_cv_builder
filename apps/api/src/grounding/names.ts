import { normalize } from './normalize.js';

/**
 * A value checked as a whole against its evidence: a structured proper noun (`company`,
 * `institution`, `contact.name`, AC-7.3) or a skill name (AC-7.4). It must occur there as a whole
 * word sequence, case-insensitive: "Java" is not in "JavaScript", "C" is not in "C++".
 */
export function nameInEvidence(value: string, evidence: string[]): boolean {
  const name = normalize(value);
  return name !== '' && containsWord(normalize(evidence.join(' \n ')), name);
}

function containsWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\d+#])${escaped}(?![\\p{L}\\d+#])`, 'u').test(haystack);
}

// Capitalized words that are not names in any field: the pronoun, common office abbreviations.
const NOT_NAMES = new Set(['i', 'cv', 'ceo', 'cfo', 'coo', 'cto', 'hr', 'q1', 'q2', 'q3', 'q4']);

/**
 * Capitalized tokens in free text (bullets, summary) that do not start a sentence and do not
 * occur in the evidence (AC-7.3). This is what
 * catches "Worked at Google" when Google is not in the source. Returns the offending tokens.
 */
export function unsupportedCapitalizedTokens(text: string, evidence: string[]): string[] {
  const joined = normalize(evidence.join(' \n '));
  const offending: string[] = [];

  for (const match of text.matchAll(/[\p{Lu}][\p{L}\d.+#&-]*/gu)) {
    const token = match[0].replace(/[.\-&]+$/, '');
    const before = text.slice(0, match.index).trimEnd();
    const startsSentence = before === '' || /[.!?:;•\n]$/.test(before);
    if (startsSentence || NOT_NAMES.has(token.toLowerCase())) continue;
    if (containsWord(joined, normalize(token))) continue;
    offending.push(token);
  }
  return offending;
}
