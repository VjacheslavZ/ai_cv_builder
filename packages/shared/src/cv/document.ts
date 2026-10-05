import { z } from 'zod';
import { fieldPathSchema } from '../field-path/field-path-schema.js';

// The CV document (SPEC §0): structured JSON stored in `Cv.document`. Every entry, bullet, link,
// and skill has a stable UUID so questions, PATCH ops, and the AI merge can address it.
//
// Manual edits are tracked as one document-level set, `editedPaths`, not as per-field
// `userEdited` flags: scalar fields (`summary`, `contact.email`) stay plain strings, the set
// moves with the document in every whole-document write, and "is this place edited by hand"
// is `editedPaths.some(p => isFieldPathWithin(path, p))`. Phase 4 relies on this choice.

export const BULLET_MAX_LENGTH = 500;
export const SUMMARY_MAX_LENGTH = 2_000;
export const SHORT_TEXT_MAX_LENGTH = 200;
export const URL_MAX_LENGTH = 2_048;
/** How many removed items a CV remembers (oldest dropped first). */
export const REMOVED_MAX = 200;

const id = z.uuid();
const shortText = z.string().trim().max(SHORT_TEXT_MAX_LENGTH);

const padMonth = (date: string, month: string) => (date.length === 4 ? `${date}-${month}` : date);

/** `YYYY` or `YYYY-MM` (SPEC glossary). */
export const cvDateSchema = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, 'Use YYYY or YYYY-MM');

/** `{ start, end }`; `end` may be `present`. A year alone spans the whole year. */
export const cvDateRangeSchema = z
  .object({
    start: cvDateSchema,
    end: z.union([cvDateSchema, z.literal('present')]),
  })
  .refine((d) => d.end === 'present' || padMonth(d.start, '01') <= padMonth(d.end, '12'), {
    message: 'The end date is before the start date',
    path: ['end'],
  });
export type CvDateRange = z.infer<typeof cvDateRangeSchema>;

/** Only `http(s):` and `mailto:` links (AC-10.6, NFR-S7). */
export const cvUrlSchema = z
  .string()
  .trim()
  .max(URL_MAX_LENGTH)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        if (url.protocol === 'mailto:') return url.pathname.length > 0;
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
      } catch {
        return false;
      }
    },
    { message: 'Use an http(s) or mailto link' },
  );

export const cvLinkSchema = z.object({ id, label: shortText, url: cvUrlSchema });

export const cvContactSchema = z.object({
  name: shortText,
  email: shortText,
  phone: shortText,
  city: shortText,
  links: z.array(cvLinkSchema).max(10),
});

export const cvBulletSchema = z.object({
  id,
  text: z.string().trim().max(BULLET_MAX_LENGTH),
});

export const cvExperienceSchema = z.object({
  id,
  company: shortText,
  title: shortText,
  dates: cvDateRangeSchema.nullable(),
  bullets: z.array(cvBulletSchema).max(30),
});

export const cvEducationSchema = z.object({
  id,
  institution: shortText,
  degree: shortText,
  dates: cvDateRangeSchema.nullable(),
});

export const cvSkillSchema = z.object({ id, name: z.string().trim().min(1).max(100) });

export const cvDocumentSchema = z.object({
  contact: cvContactSchema,
  summary: z.string().trim().max(SUMMARY_MAX_LENGTH),
  experience: z.array(cvExperienceSchema).max(30),
  education: z.array(cvEducationSchema).max(20),
  skills: z.array(cvSkillSchema).max(100),
  /** Places edited by hand; the AI never changes them (AC-9.3). Field or list/section paths. */
  editedPaths: z.array(fieldPathSchema).max(1_000).default([]),
  /**
   * Items the user removed (AC-10.2), by list and normalized text (`removedKey`): an AI rewrite
   * never adds them back. Optional: documents saved before Phase 7 have none.
   */
  removed: z
    .array(z.object({ list: fieldPathSchema, key: z.string().max(1_000) }))
    .max(REMOVED_MAX)
    .optional(),
});

export type CvDocument = z.infer<typeof cvDocumentSchema>;
export type CvContact = z.infer<typeof cvContactSchema>;
export type CvLink = z.infer<typeof cvLinkSchema>;
export type CvExperience = z.infer<typeof cvExperienceSchema>;
export type CvBullet = z.infer<typeof cvBulletSchema>;
export type CvEducation = z.infer<typeof cvEducationSchema>;
export type CvSkill = z.infer<typeof cvSkillSchema>;
export type CvRemovedItem = NonNullable<CvDocument['removed']>[number];

export function emptyCvDocument(): CvDocument {
  return {
    contact: { name: '', email: '', phone: '', city: '', links: [] },
    summary: '',
    experience: [],
    education: [],
    skills: [],
    editedPaths: [],
  };
}
