import type { CvDateRange, CvDocument } from '@cv/shared';

function formatDates(dates: CvDateRange | null): string | null {
  if (!dates) return null;
  return `${dates.start} – ${dates.end === 'present' ? 'Present' : dates.end}`;
}

/**
 * A plain read-only rendering of the draft (text only, React-escaped: NFR-S7). The full view
 * with questions arrives in Phase 3, the editor in Phase 4.
 */
export function CvDraftPreview({ document }: { document: CvDocument }) {
  const { contact } = document;
  const contactLine = [contact.email, contact.phone, contact.city].filter(Boolean).join(' · ');

  return (
    <article className="flex flex-col gap-5 rounded-xl border p-4 sm:p-6">
      {(contact.name || contactLine) && (
        <header className="flex flex-col gap-1">
          {contact.name && <h2 className="text-xl font-semibold">{contact.name}</h2>}
          {contactLine && <p className="text-sm text-muted-foreground">{contactLine}</p>}
        </header>
      )}

      {document.summary && (
        <Section title="Summary">
          <p className="text-sm">{document.summary}</p>
        </Section>
      )}

      {document.experience.length > 0 && (
        <Section title="Experience">
          {document.experience.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-1">
              <p className="text-sm font-medium">
                {[entry.title, entry.company].filter(Boolean).join(' · ')}
              </p>
              {formatDates(entry.dates) && (
                <p className="text-xs text-muted-foreground">{formatDates(entry.dates)}</p>
              )}
              <ul className="ml-4 list-disc text-sm">
                {entry.bullets.map((bullet) => (
                  <li key={bullet.id} className="break-words">
                    {bullet.text}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>
      )}

      {document.education.length > 0 && (
        <Section title="Education">
          {document.education.map((entry) => (
            <p key={entry.id} className="text-sm">
              {[entry.degree, entry.institution].filter(Boolean).join(' · ')}
              {formatDates(entry.dates) && (
                <span className="text-muted-foreground"> ({formatDates(entry.dates)})</span>
              )}
            </p>
          ))}
        </Section>
      )}

      {document.skills.length > 0 && (
        <Section title="Skills">
          <p className="text-sm">{document.skills.map((skill) => skill.name).join(', ')}</p>
        </Section>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
