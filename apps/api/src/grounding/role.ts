import { normalize } from './normalize.js';

// Words of a role that carry no claim on their own.
const FILLER = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'for', 'in', 'at', 'to', 'with']);

/**
 * The target role is a goal, not a fact (AC-7.7): returns the role's words that the source does
 * not contain but `text` does (e.g. "senior", "backend"). An empty list means no claim.
 */
export function roleClaims(text: string, targetRole: string, normalizedSource: string): string[] {
  const words = (s: string) =>
    new Set(
      normalize(s)
        .split(/[^\p{L}\d+#]+/u)
        .filter(Boolean),
    );
  const inText = words(text);
  const inSource = words(normalizedSource);
  return [...words(targetRole)].filter(
    (w) => !FILLER.has(w) && w.length > 1 && !inSource.has(w) && inText.has(w),
  );
}
