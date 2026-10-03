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
