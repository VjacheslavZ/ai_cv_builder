import {
  isValidFieldPath,
  OPEN_QUESTIONS_MAX,
  questionPriority,
  type LlmQuestion,
  type QuestionType,
} from '@cv/shared';

export interface DraftQuestion {
  path: string;
  type: QuestionType;
  text: string;
  priority: number;
}

export function question(path: string, type: QuestionType, text: string): DraftQuestion {
  return { path, type, text, priority: questionPriority(path, type) };
}

// Texts for removed facts never mention the removed value (AC-7.5).
const UNVERIFIED_TEXT: Record<string, string> = {
  'contact.name': 'We could not confirm your name from what you provided. What is your full name?',
  'contact.email': 'We could not confirm your email. What email should employers use?',
  'contact.phone': 'We could not confirm your phone number. What number should be on your CV?',
  'contact.city': 'We could not confirm your city. Where are you based?',
  'contact.links': 'A link could not be confirmed. Which links should your CV show?',
  summary: 'Part of your summary could not be backed by your source. What should it highlight?',
  experience: 'A job could not be verified against your source. Is any work experience missing?',
  education: 'An education entry could not be verified. What education should be listed?',
  skills:
    'Some skills were not found in your source. Which skills, tools, or certifications do you have?',
};
const UNVERIFIED_BULLETS =
  'Some details of this role could not be verified. What did you achieve here?';

export function unverifiedQuestion(path: string): DraftQuestion {
  const text = path.endsWith('.bullets')
    ? UNVERIFIED_BULLETS
    : (UNVERIFIED_TEXT[path] ?? 'Something here could not be verified. Can you add details?');
  return question(path, 'unverified', text);
}

/**
 * LLM questions use indexes (`experience.0.dates`); map them to the ids of the entries that
 * survived grounding. Questions about removed entries or invalid paths are dropped.
 */
export function mapLlmQuestions(
  questions: LlmQuestion[],
  ids: { experience: Map<number, string>; education: Map<number, string> },
): DraftQuestion[] {
  return questions.flatMap((q) => {
    const path = q.path.replace(
      /^(experience|education)\.(\d+)(?=\.|$)/,
      (whole, section: 'experience' | 'education', index: string) =>
        ids[section].get(Number(index)) ? `${section}.${ids[section].get(Number(index))}` : whole,
    );
    return isValidFieldPath(path) ? [question(path, q.type, q.text)] : [];
  });
}

/** One question per path (the most important type wins), most important first, at most 10. */
export function finalizeQuestions(questions: DraftQuestion[]): DraftQuestion[] {
  const byPath = new Map<string, DraftQuestion>();
  for (const q of questions) {
    const current = byPath.get(q.path);
    if (!current || q.priority < current.priority) byPath.set(q.path, q);
  }
  return [...byPath.values()].sort((a, b) => a.priority - b.priority).slice(0, OPEN_QUESTIONS_MAX);
}
