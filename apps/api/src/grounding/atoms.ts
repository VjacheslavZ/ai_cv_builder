// AC-7.3, kept small on purpose: every number in an element must appear in its own evidence, and
// an email or URL must appear there as written. Units, currencies, and number formats are the
// prompt's job ("copy every number exactly as the source writes it"); a number the source does
// not have at all is what this catches ("Increased throughput by 40%" from "We rewrote the API").

/** "1,200,000" and "1.200.000" are one number; "01.2020" and "1.5" are two. */
const THOUSANDS = /\d{1,3}(?:[.,]\d{3})+(?!\d)/g;

/** The numbers in a text as digit runs, without thousands separators or leading zeros. */
export function numbersIn(text: string): string[] {
  const digits = text.replace(THOUSANDS, (m) => m.replace(/[.,]/g, '')).match(/\d+/g) ?? [];
  return digits.map((d) => d.replace(/^0+(?=\d)/, ''));
}

/** Numbers of `text` that `evidence` does not contain (the caller passes one element's quotes). */
export function missingNumbers(text: string, evidence: string): string[] {
  const known = new Set(numbersIn(evidence));
  return numbersIn(text).filter((n) => !known.has(n));
}

/** An email or URL as written in the evidence, ignoring case, scheme, "www.", a trailing slash. */
export function valueInEvidence(value: string, evidence: string): boolean {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/, '')
    .replace(/\/+$/, '');
  return key !== '' && evidence.toLowerCase().includes(key);
}
