import type { CvContact } from '@cv/shared';

import type { QuestionMarks } from '@/lib/question-marks';
import { Marked, Missing } from './marked';

const FIELDS = [
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
] as const;

/** Name and contact line; an empty field shows only when a question points at it. */
export function DraftContact({ contact, marks }: { contact: CvContact; marks: QuestionMarks }) {
  const shown = FIELDS.filter((f) => contact[f.key] || marks.at(`contact.${f.key}`));
  const showName = contact.name || marks.at('contact.name');
  if (!showName && shown.length === 0 && contact.links.length === 0) return null;

  return (
    <header className="flex flex-col gap-1.5">
      {showName && (
        <Marked path="contact.name" marks={marks}>
          {contact.name ? (
            <h2 className="text-xl font-semibold break-words">{contact.name}</h2>
          ) : (
            <Missing label="Your name" />
          )}
        </Marked>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {shown.map((f) => (
          <Marked key={f.key} path={`contact.${f.key}`} marks={marks}>
            {contact[f.key] ? (
              <span className="break-all">{contact[f.key]}</span>
            ) : (
              <Missing label={f.label} />
            )}
          </Marked>
        ))}
        {contact.links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            rel="noopener noreferrer nofollow"
            target="_blank"
            className="break-all underline underline-offset-4"
          >
            {link.label || link.url}
          </a>
        ))}
      </div>
    </header>
  );
}
