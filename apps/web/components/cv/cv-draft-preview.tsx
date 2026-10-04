import type { CvDocument } from '@cv/shared';

import type { QuestionMarks } from '@/lib/question-marks';
import { DraftContact } from './draft/draft-contact';
import { Missing, Section } from './draft/marked';
import { DraftEducation, DraftExperience, DraftSkills } from './draft/draft-sections';

/**
 * The read-only draft (text only, React-escaped: NFR-S7), with the places that have open
 * questions highlighted (AC-8.1). Editing arrives in Phase 4.
 */
export function CvDraftPreview({
  document,
  marks,
}: {
  document: CvDocument;
  marks: QuestionMarks;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-5 rounded-xl border p-4 sm:p-6">
      <DraftContact contact={document.contact} marks={marks} />
      {(document.summary || marks.at('summary')) && (
        <Section title="Summary" path="summary" marks={marks}>
          {document.summary ? (
            <p className="text-sm break-words">{document.summary}</p>
          ) : (
            <Missing label="No summary yet" />
          )}
        </Section>
      )}
      <DraftExperience document={document} marks={marks} />
      <DraftEducation document={document} marks={marks} />
      <DraftSkills document={document} marks={marks} />
    </article>
  );
}
