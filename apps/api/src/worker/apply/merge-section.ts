import {
  getField,
  isFieldPathWithin,
  isRemovedItem,
  parseFieldPath,
  setField,
  type CvDocument,
  type CvEducation,
  type CvExperience,
} from '@cv/shared';

export interface MergeSectionInput {
  /** The CV as it is at commit time, under the row lock. */
  current: CvDocument;
  /** The rewritten entry or section (`applyScopeFor`). */
  scope: string;
  /** The grounded rewrite; only `scope` is read from it. Kept items carry their ids. */
  rewritten: CvDocument;
  /** Ids of existing items the model returned, before grounding removed any. */
  returnedIds: ReadonlySet<string>;
}

/**
 * Puts an AI rewrite of one entry or section onto the current document (AC-9.3, NFR-R6):
 *
 * - items are matched by id; items without a known id are new, unless the user removed an
 *   item like it (`CvDocument.removed`, AC-10.2): the AI never adds back what was deleted;
 * - an existing item the model returned but grounding removed keeps its current version;
 * - an item with a manual edit cannot be dropped or moved: it goes back to its original place;
 * - a scalar the rewrite left empty keeps its current value (a rewrite fills, it never clears);
 * - finally every `editedPaths` field is restored from the current document byte for byte,
 *   which also covers fields edited while the job ran.
 *
 * Pure: the caller writes the result under the CV row lock.
 */
export function mergeSection(input: MergeSectionInput): CvDocument {
  const { current, scope, rewritten, returnedIds } = input;
  const doc = structuredClone(current);
  const edited = (path: string) => current.editedPaths.some((p) => isFieldPathWithin(p, path));
  const list = <T extends { id: string }>(
    listPath: string,
    cur: T[],
    next: T[],
    mergeItem?: (cur: T, next: T) => T,
  ) =>
    mergeList(cur, next, {
      returnedIds,
      isPinned: (item) => edited(`${listPath}.${item.id}`),
      isRemoved: (item) => isRemovedItem(current, listPath, item),
      mergeItem,
    });

  const mergeExperience = (cur: CvExperience, next: CvExperience): CvExperience => ({
    id: cur.id,
    company: next.company || cur.company,
    title: next.title || cur.title,
    dates: next.dates ?? cur.dates,
    bullets: list(`experience.${cur.id}.bullets`, cur.bullets, next.bullets),
  });
  const mergeEducation = (cur: CvEducation, next: CvEducation): CvEducation => ({
    id: cur.id,
    institution: next.institution || cur.institution,
    degree: next.degree || cur.degree,
    dates: next.dates ?? cur.dates,
  });

  const parts = parseFieldPath(scope);
  switch (parts?.section) {
    case 'summary':
      doc.summary = rewritten.summary || current.summary;
      break;
    case 'contact':
      for (const field of ['name', 'email', 'phone', 'city'] as const) {
        doc.contact[field] = rewritten.contact[field] || current.contact[field];
      }
      doc.contact.links = list('contact.links', current.contact.links, rewritten.contact.links);
      break;
    case 'skills':
      doc.skills = list('skills', current.skills, rewritten.skills);
      break;
    case 'experience': {
      if (!parts.entryId) {
        doc.experience = list(
          'experience',
          current.experience,
          rewritten.experience,
          mergeExperience,
        );
        break;
      }
      const index = doc.experience.findIndex((e) => e.id === parts.entryId);
      const next = pickEntry(rewritten.experience, parts.entryId);
      if (index >= 0 && next) doc.experience[index] = mergeExperience(doc.experience[index]!, next);
      break;
    }
    case 'education': {
      if (!parts.entryId) {
        doc.education = list('education', current.education, rewritten.education, mergeEducation);
        break;
      }
      const index = doc.education.findIndex((e) => e.id === parts.entryId);
      const next = pickEntry(rewritten.education, parts.entryId);
      if (index >= 0 && next) doc.education[index] = mergeEducation(doc.education[index]!, next);
      break;
    }
  }
  return restoreEditedFields(doc, current);
}

/** The rewrite of one entry: the item with its id, or the only item when the id was omitted. */
function pickEntry<T extends { id: string }>(items: T[], entryId: string): T | undefined {
  return items.find((i) => i.id === entryId) ?? (items.length === 1 ? items[0] : undefined);
}

interface MergeListOptions<T> {
  returnedIds: ReadonlySet<string>;
  /** Items that must stay where they are (they hold a manual edit). */
  isPinned: (item: T) => boolean;
  /** New items the user already removed once: dropped. */
  isRemoved?: (item: T) => boolean;
  mergeItem?: (cur: T, next: T) => T;
}

/** Id-based list merge; see `mergeSection`. Duplicated ids in the rewrite keep the first. */
export function mergeList<T extends { id: string }>(
  current: T[],
  rewritten: T[],
  { returnedIds, isPinned, isRemoved, mergeItem }: MergeListOptions<T>,
): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let result = rewritten.flatMap((item) => {
    if (seen.has(item.id)) return [];
    seen.add(item.id);
    const cur = byId.get(item.id);
    if (!cur && isRemoved?.(item)) return [];
    return [cur && mergeItem ? mergeItem(cur, item) : item];
  });

  // Back to their original place: manually edited items, and existing items the model kept
  // but grounding removed (the current version is still grounded).
  const kept = new Map(result.map((item) => [item.id, item]));
  const pinned = current
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isPinned(item) || (returnedIds.has(item.id) && !kept.has(item.id)));
  const pinnedIds = new Set(pinned.map(({ item }) => item.id));
  result = result.filter((item) => !pinnedIds.has(item.id));
  for (const { item, index } of pinned) {
    result.splice(Math.min(index, result.length), 0, kept.get(item.id) ?? item);
  }
  return result;
}

/** Copies every `editedPaths` field from `source` into `doc` unchanged (AC-9.3). */
export function restoreEditedFields(doc: CvDocument, source: CvDocument): CvDocument {
  for (const path of source.editedPaths) {
    const value = getField(source, path);
    if (value !== undefined) setField(doc, path, structuredClone(value));
  }
  doc.editedPaths = [...source.editedPaths];
  return doc;
}
