import { z } from 'zod';
import { parseFieldPath } from '../field-path/field-path.js';
import {
  BULLET_MAX_LENGTH,
  cvDateRangeSchema,
  cvUrlSchema,
  SHORT_TEXT_MAX_LENGTH,
  SUMMARY_MAX_LENGTH,
  type CvDocument,
} from './document.js';

// The editable fields of a CV document, addressed by field path (docs/plans/README.md). A PATCH
// `set` op, a simple-field answer, and the server's restore of `editedPaths` after an AI write all
// read and write through `getField` / `setField`, so they agree on what a path means.
//
// Editable (leaf) paths:
//   contact.name | contact.email | contact.phone | contact.city
//   contact.links.<linkId>                     → { label, url }
//   summary
//   experience.<id>.company | .title | .dates  (dates → { start, end } | null)
//   experience.<id>.bullets.<bulletId>         → bullet text
//   education.<id>.institution | .degree | .dates
//   skills.<skillId>                           → skill name

const CONTACT_FIELDS = ['name', 'email', 'phone', 'city'] as const;
const EXPERIENCE_FIELDS = ['company', 'title', 'dates'] as const;
const EDUCATION_FIELDS = ['institution', 'degree', 'dates'] as const;

const shortText = z.string().trim().max(SHORT_TEXT_MAX_LENGTH);
const PHONE_RE = /^\+?[\d\s().-]{6,30}$/;

/** An email, or empty to clear the field. */
export const cvEmailSchema = shortText.refine((v) => v === '' || z.email().safeParse(v).success, {
  message: 'Enter a valid email address',
});

/** Digits with spaces, dashes, dots, parentheses, and an optional leading "+"; or empty. */
export const cvPhoneSchema = shortText.refine((v) => v === '' || PHONE_RE.test(v), {
  message: 'Enter a valid phone number',
});

const linkValueSchema = z.object({ label: shortText, url: cvUrlSchema });

const includes = <T extends string>(list: readonly T[], value: string | undefined): value is T =>
  value !== undefined && (list as readonly string[]).includes(value);

/**
 * The schema for the value of a `set` op at `path` (AC-10.6), or `null` when the path is not an
 * editable field (a section, a list, an unknown field).
 */
export function fieldValueSchema(path: string): z.ZodType | null {
  const parts = parseFieldPath(path);
  if (!parts) return null;
  switch (parts.section) {
    case 'summary':
      return z.string().trim().max(SUMMARY_MAX_LENGTH);
    case 'skills':
      return parts.itemId ? z.string().trim().min(1, 'A skill cannot be empty').max(100) : null;
    case 'contact':
      if (parts.field === 'links') return parts.itemId ? linkValueSchema : null;
      if (parts.itemId || !includes(CONTACT_FIELDS, parts.field)) return null;
      if (parts.field === 'email') return cvEmailSchema;
      if (parts.field === 'phone') return cvPhoneSchema;
      return shortText;
    case 'experience':
    case 'education': {
      if (!parts.entryId || !parts.field) return null;
      if (parts.section === 'experience' && parts.field === 'bullets') {
        return parts.itemId ? z.string().trim().max(BULLET_MAX_LENGTH) : null;
      }
      const fields = parts.section === 'experience' ? EXPERIENCE_FIELDS : EDUCATION_FIELDS;
      if (parts.itemId || !includes(fields, parts.field)) return null;
      return parts.field === 'dates' ? cvDateRangeSchema.nullable() : shortText;
    }
  }
}

export function isEditableField(path: string): boolean {
  return fieldValueSchema(path) !== null;
}

/** The current value at an editable path, or `undefined` when the entry or item is gone. */
export function getField(doc: CvDocument, path: string): unknown {
  const parts = parseFieldPath(path);
  if (!parts || !isEditableField(path)) return undefined;
  switch (parts.section) {
    case 'summary':
      return doc.summary;
    case 'skills':
      return doc.skills.find((s) => s.id === parts.itemId)?.name;
    case 'contact': {
      if (parts.field !== 'links')
        return doc.contact[parts.field as (typeof CONTACT_FIELDS)[number]];
      const link = doc.contact.links.find((l) => l.id === parts.itemId);
      return link && { label: link.label, url: link.url };
    }
    case 'experience': {
      const entry = doc.experience.find((e) => e.id === parts.entryId);
      if (!entry) return undefined;
      if (parts.field === 'bullets') return entry.bullets.find((b) => b.id === parts.itemId)?.text;
      return entry[parts.field as (typeof EXPERIENCE_FIELDS)[number]];
    }
    case 'education': {
      const entry = doc.education.find((e) => e.id === parts.entryId);
      return entry?.[parts.field as (typeof EDUCATION_FIELDS)[number]];
    }
  }
}

/**
 * Writes `value` (already validated with `fieldValueSchema`) at an editable path, in place.
 * Returns `false` when the path is not editable or its entry or item does not exist; adding and
 * removing items is a separate op (Phase 7).
 */
export function setField(doc: CvDocument, path: string, value: unknown): boolean {
  const parts = parseFieldPath(path);
  if (!parts || !isEditableField(path)) return false;
  switch (parts.section) {
    case 'summary':
      doc.summary = value as string;
      return true;
    case 'skills': {
      const skill = doc.skills.find((s) => s.id === parts.itemId);
      if (skill) skill.name = value as string;
      return !!skill;
    }
    case 'contact': {
      if (parts.field !== 'links') {
        doc.contact[parts.field as (typeof CONTACT_FIELDS)[number]] = value as string;
        return true;
      }
      const link = doc.contact.links.find((l) => l.id === parts.itemId);
      if (link) Object.assign(link, value as { label: string; url: string });
      return !!link;
    }
    case 'experience': {
      const entry = doc.experience.find((e) => e.id === parts.entryId);
      if (!entry) return false;
      if (parts.field === 'bullets') {
        const bullet = entry.bullets.find((b) => b.id === parts.itemId);
        if (bullet) bullet.text = value as string;
        return !!bullet;
      }
      Object.assign(entry, { [parts.field as string]: value });
      return true;
    }
    case 'education': {
      const entry = doc.education.find((e) => e.id === parts.entryId);
      if (entry) Object.assign(entry, { [parts.field as string]: value });
      return !!entry;
    }
  }
}

/**
 * Single-value fields an answer is written to directly, without the LLM (AC-9.2): contact
 * fields, dates, and the spelling of proper nouns (company, institution, full name).
 */
export function isSimpleField(path: string): boolean {
  const parts = parseFieldPath(path);
  if (!parts) return false;
  if (parts.section === 'contact') return includes(CONTACT_FIELDS, parts.field) && !parts.itemId;
  if (parts.section !== 'experience' && parts.section !== 'education') return false;
  if (!parts.entryId || parts.itemId) return false;
  return (
    parts.field === 'dates' ||
    (parts.section === 'experience' && parts.field === 'company') ||
    (parts.section === 'education' && parts.field === 'institution')
  );
}

/**
 * The part of the CV an `apply_answer` job rewrites for a question at `path` (AC-9.1): one entry
 * for anything inside it, otherwise the whole section. `null` for an invalid path.
 */
export function applyScopeFor(path: string): string | null {
  const parts = parseFieldPath(path);
  if (!parts) return null;
  if (parts.section === 'experience' || parts.section === 'education') {
    return parts.entryId ? `${parts.section}.${parts.entryId}` : parts.section;
  }
  return parts.section;
}
