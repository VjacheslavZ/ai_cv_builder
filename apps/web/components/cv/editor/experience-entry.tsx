'use client';

import { useFieldArray } from 'react-hook-form';

import { DatesField } from './dates-field';
import { EditableField } from './editable-field';
import { useEditor } from './editor-context';
import { FieldAnchor, SectionFrame } from './section-frame';

/** One job: company, title, dates, and its bullets, each saved on its own path. */
export function ExperienceEntry({ index, id }: { index: number; id: string }) {
  const { form } = useEditor();
  const bullets = useFieldArray({
    control: form.control,
    name: `experience.${index}.bullets`,
    keyName: 'key',
  });
  const base = `experience.${id}`;

  return (
    <SectionFrame path={base} className="border-t pt-3 first:border-t-0 first:pt-0">
      <div className="grid gap-3 sm:grid-cols-2">
        <EditableField name={`experience.${index}.title`} path={`${base}.title`} label="Title" />
        <FieldAnchor path={`${base}.company`}>
          <EditableField
            name={`experience.${index}.company`}
            path={`${base}.company`}
            label="Company"
          />
        </FieldAnchor>
      </div>
      <FieldAnchor path={`${base}.dates`}>
        <DatesField name={`experience.${index}.dates`} path={`${base}.dates`} />
      </FieldAnchor>
      <FieldAnchor path={`${base}.bullets`}>
        <ul className="flex flex-col gap-2" aria-label="Achievements">
          {bullets.fields.map((bullet, b) => (
            <li key={bullet.key} className="flex gap-2">
              <span aria-hidden className="mt-3 text-muted-foreground">
                •
              </span>
              <EditableField
                name={`experience.${index}.bullets.${b}.text`}
                path={`${base}.bullets.${bullet.id}`}
                label={`Achievement ${b + 1}`}
                hideLabel
                multiline
                className="flex-1"
              />
            </li>
          ))}
        </ul>
        {bullets.fields.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No achievements yet.</p>
        )}
      </FieldAnchor>
    </SectionFrame>
  );
}
