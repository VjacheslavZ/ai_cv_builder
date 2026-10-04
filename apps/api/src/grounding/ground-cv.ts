import { randomUUID } from 'node:crypto';
import {
  cvDateRangeSchema,
  cvUrlSchema,
  emptyCvDocument,
  type CvDateRange,
  type CvDocument,
  type LlmCvOutput,
} from '@cv/shared';
import { missingNumbers, valueInEvidence } from './atoms.js';
import { nameInEvidence, unsupportedCapitalizedTokens } from './names.js';
import { quoteInSource } from './normalize.js';
import {
  finalizeQuestions,
  mapLlmQuestions,
  question,
  unverifiedQuestion,
  type DraftQuestion,
} from './questions.js';
import { roleClaims } from './role.js';
import { groundingSource } from './source.js';

export type RemovalReason =
  | 'QUOTE_NOT_FOUND'
  | 'ATOM_NOT_IN_EVIDENCE'
  | 'NAME_NOT_IN_EVIDENCE'
  | 'SKILL_NOT_IN_EVIDENCE'
  | 'ROLE_CLAIM'
  | 'INVALID_VALUE';

/** What grounding removed: paths and reasons only, never values (logs and `GroundingReport`). */
export interface Removal {
  path: string;
  reason: RemovalReason;
}

export interface GroundingInput {
  output: LlmCvOutput;
  sources: string[];
  targetRole: string;
  /** AC-7.3's capitalized-token rule for free text; configurable because it can be strict. */
  checkCapitalizedTokens: boolean;
  /** After the one re-request (AC-7.7): drop a summary that claims the role and ask instead. */
  dropSummaryOnRoleClaim?: boolean;
}

export interface GroundingResult {
  document: CvDocument;
  removed: Removal[];
  questions: DraftQuestion[];
  /** The summary claims the target role; the caller re-requests once with feedback. */
  summaryRoleClaim: boolean;
}

interface Check {
  evidence: string[];
  /** Texts whose numbers must be inside this element's evidence (AC-7.3 "same context"). */
  atoms?: string[];
  /** Emails and URLs that must be inside this element's evidence as written. */
  values?: string[];
  /** Structured proper nouns checked as whole values. */
  names?: string[];
  /** Free text: capitalized tokens must be in the evidence. */
  freeText?: string[];
  /** Titles: must not claim the target role. */
  roleText?: string[];
}

/**
 * The deterministic grounding check (FR-7). Every element of the LLM output is kept only if its
 * quotes are in the source and its atoms, names, and skills are backed by them; anything else
 * is removed and turned into an `unverified` question (AC-7.5). Pure: no I/O, no clock.
 */
export function groundCv(input: GroundingInput): GroundingResult {
  const { output, targetRole } = input;
  const source = groundingSource(input.sources);
  const removed: Removal[] = [];
  const questions: DraftQuestion[] = [];

  const check = (c: Check): RemovalReason | null => {
    if (!c.evidence.every((quote) => quoteInSource(quote, source))) return 'QUOTE_NOT_FOUND';
    const evidence = c.evidence.join('\n');
    if (
      (c.atoms ?? []).some((text) => missingNumbers(text, evidence).length > 0) ||
      (c.values ?? []).some((value) => !valueInEvidence(value, evidence))
    ) {
      return 'ATOM_NOT_IN_EVIDENCE';
    }
    if ((c.names ?? []).some((name) => name && !nameInEvidence(name, c.evidence))) {
      return 'NAME_NOT_IN_EVIDENCE';
    }
    if (
      input.checkCapitalizedTokens &&
      (c.freeText ?? []).some((t) => unsupportedCapitalizedTokens(t, c.evidence).length > 0)
    ) {
      return 'NAME_NOT_IN_EVIDENCE';
    }
    if ((c.roleText ?? []).some((t) => roleClaims(t, targetRole, source).length > 0)) {
      return 'ROLE_CLAIM';
    }
    return null;
  };
  const remove = (path: string, reason: RemovalReason) => {
    removed.push({ path, reason });
    questions.push(unverifiedQuestion(path));
  };

  const doc = emptyCvDocument();

  // Contact: each field is its own element.
  for (const field of ['name', 'email', 'phone', 'city'] as const) {
    const item = output.contact[field];
    if (!item) continue;
    const isName = field === 'name' || field === 'city';
    const reason = check({
      evidence: item.evidence,
      atoms: [item.value],
      values: field === 'email' ? [item.value] : [],
      names: isName ? [item.value] : [],
    });
    if (reason) remove(`contact.${field}`, reason);
    else doc.contact[field] = item.value.trim();
  }
  for (const link of output.contact.links) {
    const reason = cvUrlSchema.safeParse(link.url).success
      ? check({ evidence: link.evidence, atoms: [link.url], values: [link.url] })
      : 'INVALID_VALUE';
    if (reason) remove('contact.links', reason);
    else
      doc.contact.links.push({ id: randomUUID(), label: link.label.trim(), url: link.url.trim() });
  }

  // Experience: an entry stands or falls with its company, title, and dates; bullets one by one.
  const experienceIds = new Map<number, string>();
  output.experience.forEach((entry, index) => {
    const reason = check({
      evidence: entry.evidence,
      atoms: [years(entry.start, entry.end)],
      names: [entry.company],
      roleText: [entry.title],
    });
    if (reason) return remove('experience', reason);
    const id = randomUUID();
    experienceIds.set(index, id);
    const bullets = entry.bullets.filter((bullet) => {
      const bulletReason = check({
        evidence: bullet.evidence,
        atoms: [bullet.text],
        freeText: [bullet.text],
      });
      if (bulletReason) remove(`experience.${id}.bullets`, bulletReason);
      return !bulletReason;
    });
    doc.experience.push({
      id,
      company: entry.company.trim(),
      title: entry.title.trim(),
      dates: dateRange(entry.start, entry.end),
      bullets: bullets.map((b) => ({ id: randomUUID(), text: b.text.trim() })),
    });
  });

  const educationIds = new Map<number, string>();
  output.education.forEach((entry, index) => {
    const reason = check({
      evidence: entry.evidence,
      atoms: [entry.degree, years(entry.start, entry.end)],
      names: [entry.institution],
      freeText: [entry.degree],
    });
    if (reason) return remove('education', reason);
    const id = randomUUID();
    educationIds.set(index, id);
    doc.education.push({
      id,
      institution: entry.institution.trim(),
      degree: entry.degree.trim(),
      dates: dateRange(entry.start, entry.end),
    });
  });

  const seenSkills = new Set<string>();
  for (const skill of output.skills) {
    const key = skill.name.trim().toLowerCase();
    if (seenSkills.has(key)) continue;
    // The prompt asks for the source's own spelling; the name must be inside its quote (AC-7.4).
    const reason =
      check({ evidence: skill.evidence }) ??
      (nameInEvidence(skill.name, skill.evidence) ? null : 'SKILL_NOT_IN_EVIDENCE');
    if (reason) remove('skills', reason);
    else {
      seenSkills.add(key);
      doc.skills.push({ id: randomUUID(), name: skill.name.trim() });
    }
  }

  // Summary: no evidence field, so atoms and names are checked against the whole source.
  let summaryRoleClaim = false;
  const summary = output.summary.trim();
  if (summary) {
    const reason =
      (missingNumbers(summary, source).length > 0 ? 'ATOM_NOT_IN_EVIDENCE' : null) ??
      (input.checkCapitalizedTokens && unsupportedCapitalizedTokens(summary, [source]).length > 0
        ? 'NAME_NOT_IN_EVIDENCE'
        : null);
    if (reason) remove('summary', reason);
    else if (roleClaims(summary, targetRole, source).length > 0) {
      summaryRoleClaim = true;
      if (input.dropSummaryOnRoleClaim) {
        removed.push({ path: 'summary', reason: 'ROLE_CLAIM' });
        questions.push(
          question('summary', 'vague', 'What should your summary say about your current role?'),
        );
      } else doc.summary = summary;
    } else doc.summary = summary;
  }

  questions.push(
    ...mapLlmQuestions(output.questions, { experience: experienceIds, education: educationIds }),
  );

  return { document: doc, removed, questions: finalizeQuestions(questions), summaryRoleClaim };
}

/** The years of `YYYY` / `YYYY-MM` dates: only the year is checked against the evidence (AC-7.3). */
function years(...dates: (string | null)[]): string {
  return dates
    .filter((d): d is string => !!d && d !== 'present')
    .map((d) => d.slice(0, 4))
    .join(' ');
}

/** `{ start, end }` when both dates exist and are in order; otherwise `null` (and a question). */
function dateRange(start: string | null, end: string | null): CvDateRange | null {
  if (!start || !end || start === 'present') return null;
  const parsed = cvDateRangeSchema.safeParse({ start, end });
  return parsed.success ? parsed.data : null;
}
