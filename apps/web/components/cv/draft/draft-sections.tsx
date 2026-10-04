import type { CvDateRange, CvDocument } from '@cv/shared';

import type { QuestionMarks } from '@/lib/question-marks';
import { Marked, Missing, Section } from './marked';

function formatDates(dates: CvDateRange | null): string | null {
  if (!dates) return null;
  return `${dates.start} – ${dates.end === 'present' ? 'Present' : dates.end}`;
}

interface SectionProps {
  document: CvDocument;
  marks: QuestionMarks;
}

/** Experience: title · company, dates, bullets. Entries and their dates and bullets are marked. */
export function DraftExperience({ document, marks }: SectionProps) {
  if (document.experience.length === 0 && !marks.at('experience')) return null;
  return (
    <Section title="Experience" path="experience" marks={marks}>
      {document.experience.length === 0 && <Missing label="No work experience yet" />}
      {document.experience.map((entry) => {
        const base = `experience.${entry.id}`;
        const dates = formatDates(entry.dates);
        return (
          <Marked key={entry.id} path={base} marks={marks} className="flex flex-col gap-1">
            <Marked path={`${base}.company`} marks={marks}>
              <p className="text-sm font-medium break-words">
                {[entry.title, entry.company].filter(Boolean).join(' · ') || 'Untitled role'}
              </p>
            </Marked>
            {(dates || marks.at(`${base}.dates`)) && (
              <Marked path={`${base}.dates`} marks={marks}>
                {dates ? (
                  <p className="text-xs text-muted-foreground">{dates}</p>
                ) : (
                  <Missing label="Dates" />
                )}
              </Marked>
            )}
            <Marked path={`${base}.bullets`} marks={marks}>
              <ul className="ml-4 list-disc text-sm">
                {entry.bullets.map((bullet) => (
                  <li key={bullet.id} className="break-words">
                    {bullet.text}
                  </li>
                ))}
              </ul>
            </Marked>
          </Marked>
        );
      })}
    </Section>
  );
}

export function DraftEducation({ document, marks }: SectionProps) {
  if (document.education.length === 0 && !marks.at('education')) return null;
  return (
    <Section title="Education" path="education" marks={marks}>
      {document.education.length === 0 && <Missing label="No education yet" />}
      {document.education.map((entry) => {
        const base = `education.${entry.id}`;
        const dates = formatDates(entry.dates);
        return (
          <Marked key={entry.id} path={base} marks={marks}>
            <p className="text-sm break-words">
              {[entry.degree, entry.institution].filter(Boolean).join(' · ')}
            </p>
            <Marked path={`${base}.dates`} marks={marks}>
              {dates ? (
                <p className="text-xs text-muted-foreground">{dates}</p>
              ) : (
                marks.at(`${base}.dates`) && <Missing label="Dates" />
              )}
            </Marked>
          </Marked>
        );
      })}
    </Section>
  );
}

export function DraftSkills({ document, marks }: SectionProps) {
  if (document.skills.length === 0 && !marks.at('skills')) return null;
  return (
    <Section title="Skills" path="skills" marks={marks}>
      {document.skills.length === 0 ? (
        <Missing label="No skills yet" />
      ) : (
        <p className="text-sm">{document.skills.map((skill) => skill.name).join(', ')}</p>
      )}
    </Section>
  );
}
