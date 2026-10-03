/**
 * Field paths address a place in the CV document (SPEC §0, docs/plans/README.md):
 *
 *   summary
 *   contact | contact.email | contact.links | contact.links.<linkId>
 *   experience | experience.<entryId> | experience.<entryId>.title
 *     | experience.<entryId>.bullets | experience.<entryId>.bullets.<bulletId>
 *   education | education.<entryId> | education.<entryId>.institution
 *   skills | skills.<skillId>
 *
 * Ids are UUIDs, field names are camelCase. A path may point at a single field or at a
 * whole list or section; `isFieldPathWithin` answers "is this field inside that section".
 */

export const CV_SECTIONS = ['contact', 'summary', 'experience', 'education', 'skills'] as const;
export type CvSection = (typeof CV_SECTIONS)[number];

export type EntrySection = 'experience' | 'education';

export type FieldPathParts =
  | { section: 'summary' }
  | { section: 'contact'; field?: string; itemId?: string }
  | { section: EntrySection; entryId?: string; field?: string; itemId?: string }
  | { section: 'skills'; itemId?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_RE = /^[a-z][a-zA-Z0-9]*$/;

const isUuid = (s: string | undefined): s is string => s !== undefined && UUID_RE.test(s);
const isField = (s: string | undefined): s is string => s !== undefined && FIELD_RE.test(s);

export function parseFieldPath(path: string): FieldPathParts | null {
  const [section, a, b, c, ...rest] = path.split('.');
  if (rest.length > 0) return null;

  switch (section) {
    case 'summary':
      return a === undefined ? { section } : null;

    case 'skills':
      if (a === undefined) return { section };
      return isUuid(a) && b === undefined ? { section, itemId: a } : null;

    case 'contact':
      if (a === undefined) return { section };
      if (!isField(a) || c !== undefined) return null;
      if (b === undefined) return { section, field: a };
      return isUuid(b) ? { section, field: a, itemId: b } : null;

    case 'experience':
    case 'education':
      if (a === undefined) return { section };
      if (!isUuid(a)) return null;
      if (b === undefined) return { section, entryId: a };
      if (!isField(b)) return null;
      if (c === undefined) return { section, entryId: a, field: b };
      return isUuid(c) ? { section, entryId: a, field: b, itemId: c } : null;

    default:
      return null;
  }
}

/** Builds a path from its parts. Throws on invalid parts: that is a programming error. */
export function buildFieldPath(parts: FieldPathParts): string {
  const segments: (string | undefined)[] = [parts.section];
  if (parts.section === 'contact') segments.push(parts.field, parts.itemId);
  if (parts.section === 'experience' || parts.section === 'education') {
    segments.push(parts.entryId, parts.field, parts.itemId);
  }
  if (parts.section === 'skills') segments.push(parts.itemId);

  // A defined segment after an undefined one (e.g. a field without an entry id) is invalid.
  const firstMissing = segments.indexOf(undefined);
  const defined = firstMissing === -1 ? segments : segments.slice(0, firstMissing);
  if (segments.slice(defined.length).some((s) => s !== undefined)) {
    throw new Error(`Invalid field path parts: ${JSON.stringify(parts)}`);
  }

  const path = defined.join('.');
  if (parseFieldPath(path) === null) {
    throw new Error(`Invalid field path parts: ${JSON.stringify(parts)}`);
  }
  return path;
}

export function isValidFieldPath(path: string): boolean {
  return parseFieldPath(path) !== null;
}

/** True when `path` equals `ancestor` or lies inside it (`experience.<id>.bullets.<id>` is within `experience`). */
export function isFieldPathWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}.`);
}
