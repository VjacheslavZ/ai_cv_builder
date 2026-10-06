import { parseFieldPath, type CvDocument } from '@cv/shared';

const SECTION_LABEL = {
  contact: 'Contact',
  summary: 'Summary',
  experience: 'Experience',
  education: 'Education',
  skills: 'Skills',
} as const;

const FIELD_LABEL: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  city: 'City',
  links: 'Links',
  company: 'Company',
  title: 'Job title',
  institution: 'Institution',
  degree: 'Degree',
  dates: 'Dates',
  bullets: 'Achievements',
};

const joinNames = (...parts: string[]) =>
  parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' — ');

/**
 * Where a question points, as readable steps: `['Experience', 'Acme — Engineer', 'Dates']`.
 * Entries and items are named from the current document; one that is gone (removed, or not
 * loaded yet) is left out rather than shown as an id.
 */
export function questionLocation(path: string, doc: Partial<CvDocument>): string[] {
  const parts = parseFieldPath(path);
  if (!parts) return [];
  const steps: string[] = [SECTION_LABEL[parts.section]];

  switch (parts.section) {
    case 'summary':
      break;
    case 'skills': {
      const skill = doc.skills?.find((s) => s.id === parts.itemId);
      if (skill?.name.trim()) steps.push(skill.name.trim());
      break;
    }
    case 'contact': {
      if (!parts.field) break;
      steps.push(FIELD_LABEL[parts.field] ?? parts.field);
      const link = doc.contact?.links.find((l) => l.id === parts.itemId);
      const linkName = link && (link.label.trim() || link.url.trim());
      if (linkName) steps.push(linkName);
      break;
    }
    case 'experience': {
      const index = doc.experience?.findIndex((e) => e.id === parts.entryId) ?? -1;
      const entry = doc.experience?.[index];
      if (!entry) break;
      steps.push(joinNames(entry.company, entry.title) || `Job ${index + 1}`);
      const bullet = entry.bullets.findIndex((b) => b.id === parts.itemId);
      if (bullet !== -1) steps.push(`Achievement ${bullet + 1}`);
      else if (parts.field) steps.push(FIELD_LABEL[parts.field] ?? parts.field);
      break;
    }
    case 'education': {
      const index = doc.education?.findIndex((e) => e.id === parts.entryId) ?? -1;
      const entry = doc.education?.[index];
      if (!entry) break;
      steps.push(joinNames(entry.institution, entry.degree) || `Education ${index + 1}`);
      if (parts.field) steps.push(FIELD_LABEL[parts.field] ?? parts.field);
      break;
    }
  }
  return steps;
}
