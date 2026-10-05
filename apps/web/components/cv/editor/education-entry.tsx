'use client';

import { DatesField } from './dates-field';
import { EditableField } from './editable-field';
import { FieldAnchor, SectionFrame } from './section-frame';

interface EducationEntryProps {
  index: number;
  id: string;
  /** The drag handle and "remove" of the whole entry. */
  controls: React.ReactNode;
}

/** One school: institution, degree, and dates, each saved on its own path. */
export function EducationEntry({ index, id, controls }: EducationEntryProps) {
  const base = `education.${id}`;

  return (
    <SectionFrame path={base}>
      <div className="flex items-start gap-1">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <FieldAnchor path={`${base}.institution`}>
            <EditableField
              name={`education.${index}.institution`}
              path={`${base}.institution`}
              label="Institution"
            />
          </FieldAnchor>
          <EditableField
            name={`education.${index}.degree`}
            path={`${base}.degree`}
            label="Degree"
          />
        </div>
        <div className="flex pt-5">{controls}</div>
      </div>
      <FieldAnchor path={`${base}.dates`}>
        <DatesField name={`education.${index}.dates`} path={`${base}.dates`} />
      </FieldAnchor>
    </SectionFrame>
  );
}
