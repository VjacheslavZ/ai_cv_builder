import {
  getField,
  isFieldPathWithin,
  parseFieldPath,
  type CvDateRange,
  type CvDocument,
  type LlmCvOutput,
} from '@cv/shared';

/** The part an `apply_answer` job rewrites, as the model sees it: with the ids of its items. */
export function currentSection(doc: CvDocument, scope: string): unknown {
  const parts = parseFieldPath(scope);
  switch (parts?.section) {
    case 'summary':
      return doc.summary;
    case 'contact':
      return doc.contact;
    case 'skills':
      return doc.skills;
    case 'experience':
      return parts.entryId ? doc.experience.find((e) => e.id === parts.entryId) : doc.experience;
    case 'education':
      return parts.entryId ? doc.education.find((e) => e.id === parts.entryId) : doc.education;
    default:
      return undefined;
  }
}

/** Every id in the part (entries, bullets, links, skills): the only ids the rewrite may keep. */
export function sectionIds(section: unknown): Set<string> {
  const ids = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      const { id } = value as { id?: unknown };
      if (typeof id === 'string') ids.add(id);
      Object.values(value).forEach(walk);
    }
  };
  walk(section);
  return ids;
}

/** Ids of existing items the model returned, before grounding (see `mergeSection`). */
export function returnedIds(output: LlmCvOutput, known: ReadonlySet<string>): Set<string> {
  return new Set([...sectionIds(output)].filter((id) => known.has(id)));
}

/** Only the rewritten part of the answer goes on to grounding; anything else is ignored. */
export function scopeOutput(output: LlmCvOutput, scope: string): LlmCvOutput {
  const section = parseFieldPath(scope)?.section;
  return {
    contact:
      section === 'contact'
        ? output.contact
        : { name: null, email: null, phone: null, city: null, links: [] },
    summary: section === 'summary' ? output.summary : '',
    experience: section === 'experience' ? output.experience : [],
    education: section === 'education' ? output.education : [],
    skills: section === 'skills' ? output.skills : [],
    questions: output.questions,
  };
}

const dateText = (d: CvDateRange) => `${d.start} - ${d.end}`;

/**
 * The current text of every field edited by hand, one per line (AC-10.3): what the user typed
 * is a fact, so "Led a team of 5 engineers" backs "5" and "team" in a later rewrite.
 */
export function editedFieldsText(doc: CvDocument): string {
  return doc.editedPaths
    .map((path) => getField(doc, path))
    .flatMap((value) => {
      if (typeof value === 'string') return value ? [value] : [];
      if (value && typeof value === 'object' && 'start' in value) {
        return [dateText(value as CvDateRange)];
      }
      if (value && typeof value === 'object' && 'url' in value) {
        const link = value as { label: string; url: string };
        return [`${link.label} ${link.url}`.trim()];
      }
      return [];
    })
    .join('\n');
}

/** Questions a rewrite may add: only those pointing inside the rewritten part. */
export function inScope<T extends { path: string }>(questions: T[], scope: string): T[] {
  return questions.filter((q) => isFieldPathWithin(q.path, scope));
}
