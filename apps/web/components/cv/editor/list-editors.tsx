'use client';

import { useFieldArray } from 'react-hook-form';

import { DatesField } from './dates-field';
import { EditableField } from './editable-field';
import { useEditor } from './editor-context';
import { ExperienceEntry } from './experience-entry';
import { FieldAnchor, SectionFrame } from './section-frame';

export function SummaryEditor() {
  return (
    <SectionFrame path="summary" title="Summary">
      <EditableField name="summary" path="summary" label="Summary" hideLabel multiline />
    </SectionFrame>
  );
}

export function ExperienceEditor() {
  const { form } = useEditor();
  const entries = useFieldArray({ control: form.control, name: 'experience', keyName: 'key' });
  return (
    <SectionFrame path="experience" title="Experience">
      {entries.fields.length === 0 && <Empty text="No work experience yet." />}
      {entries.fields.map((entry, index) => (
        <ExperienceEntry key={entry.key} index={index} id={entry.id} />
      ))}
    </SectionFrame>
  );
}

export function EducationEditor() {
  const { form } = useEditor();
  const entries = useFieldArray({ control: form.control, name: 'education', keyName: 'key' });
  return (
    <SectionFrame path="education" title="Education">
      {entries.fields.length === 0 && <Empty text="No education yet." />}
      {entries.fields.map((entry, index) => {
        const base = `education.${entry.id}`;
        return (
          <SectionFrame
            key={entry.key}
            path={base}
            className="border-t pt-3 first:border-t-0 first:pt-0"
          >
            <div className="grid gap-3 sm:grid-cols-2">
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
            <FieldAnchor path={`${base}.dates`}>
              <DatesField name={`education.${index}.dates`} path={`${base}.dates`} />
            </FieldAnchor>
          </SectionFrame>
        );
      })}
    </SectionFrame>
  );
}

export function SkillsEditor() {
  const { form } = useEditor();
  const skills = useFieldArray({ control: form.control, name: 'skills', keyName: 'key' });
  return (
    <SectionFrame path="skills" title="Skills">
      {skills.fields.length === 0 && <Empty text="No skills yet." />}
      <div className="grid gap-2 sm:grid-cols-2">
        {skills.fields.map((skill, index) => (
          <EditableField
            key={skill.key}
            name={`skills.${index}.name`}
            path={`skills.${skill.id}`}
            label={`Skill ${index + 1}`}
            hideLabel
          />
        ))}
      </div>
    </SectionFrame>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground italic">{text}</p>;
}
