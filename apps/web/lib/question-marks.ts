import { isFieldPathWithin, type QuestionDto } from '@cv/shared';

/** Which places of the CV have open questions (AC-8.1), by field path. */
export interface QuestionMarks {
  /** A question points exactly here (`experience.<id>.dates`, `education`). */
  at(path: string): boolean;
  /** A question points here or anywhere inside (an entry with a question on its dates). */
  within(path: string): boolean;
}

export function questionMarks(questions: QuestionDto[]): QuestionMarks {
  const paths = questions.filter((q) => q.status === 'open').map((q) => q.path);
  const exact = new Set(paths);
  return {
    at: (path) => exact.has(path),
    within: (path) => paths.some((p) => isFieldPathWithin(p, path)),
  };
}

/** The DOM id of the place a question points at, for "show me" links. */
export function questionAnchorId(path: string): string {
  return `cv-${path.replaceAll('.', '-')}`;
}
