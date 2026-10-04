// Clarifying questions (SPEC FR-8). Created by generation from Phase 3 on.

export const QUESTION_TYPES = ['missing', 'vague', 'unverified'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** AC-8.6. Only `open` questions count toward the cap of 10 and the dashboard counter. */
export const QUESTION_STATUSES = [
  'open',
  'applying',
  'answered',
  'dismissed',
  'resolved',
  'failed',
] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export interface QuestionDto {
  id: string;
  /** A field path or a list/section path (`fieldPathSchema`). */
  path: string;
  type: QuestionType;
  priority: number;
  text: string;
  status: QuestionStatus;
  answer: string | null;
}

/** At most this many open questions at any moment (AC-8.2, AC-8.6). */
export const OPEN_QUESTIONS_MAX = 10;

const SECTION_RANK: Record<string, number> = {
  contact: 0,
  summary: 1,
  experience: 2,
  education: 3,
  skills: 4,
};
const TYPE_RANK: Record<QuestionType, number> = { unverified: 0, missing: 1, vague: 2 };

/**
 * Lower is more important: contact > experience > education > skills (AC-8.2; the summary sits
 * between contact and experience). Within a section, unverified facts come before missing data
 * and vague wording.
 */
export function questionPriority(path: string, type: QuestionType): number {
  const section = path.split('.')[0] ?? '';
  return (SECTION_RANK[section] ?? 9) * 10 + TYPE_RANK[type];
}
