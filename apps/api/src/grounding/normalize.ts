/**
 * The one normalization applied to the source and to every quote before comparing (AC-7.2):
 * NFKC (also folds ligatures such as "ﬁ"), soft hyphens removed, end-of-line hyphenation from
 * PDF extraction joined (`devel-\nopment` → `development`), typographic quotes and dashes
 * unified, whitespace collapsed, lowercase.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/­/g, '')
    .replace(/(\p{L})-[ \t]*\r?\n[ \t]*(\p{L})/gu, '$1$2')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** True when `quote`, normalized, occurs in the normalized source. */
export function quoteInSource(quote: string, normalizedSource: string): boolean {
  const needle = normalize(quote);
  return needle.length > 0 && normalizedSource.includes(needle);
}
