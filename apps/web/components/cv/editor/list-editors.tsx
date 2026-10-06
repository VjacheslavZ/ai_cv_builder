'use client';

import { newEducation, newExperience } from '@/lib/list-items';
import { EditableField } from './editable-field';
import { EducationEntry } from './education-entry';
import { ExperienceEntry } from './experience-entry';
import { AddItemButton, RemoveItemButton } from './item-controls';
import { SectionFrame } from './section-frame';
import { SortableItem } from './sortable-item';
import { useListEditor } from './use-list-editor';

export { SkillsEditor } from './skills-editor';

const entryClass = 'border-t border-foreground pt-3 first:border-t-0 first:pt-0';

export function SummaryEditor() {
  return (
    <SectionFrame path="summary" title="Summary">
      <EditableField name="summary" path="summary" label="Summary" hideLabel multiline />
    </SectionFrame>
  );
}

export function ExperienceEditor() {
  const entries = useListEditor('experience', 'experience', 'Job');
  return (
    <SectionFrame path="experience" title="Experience">
      {entries.items.length === 0 && <Empty text="No work experience yet." />}
      <ul className="flex flex-col gap-3" aria-label="Jobs">
        {entries.items.map((entry, index) => (
          // Keyed by place too: the entry's bullets are a field array named by its index.
          <SortableItem
            key={`${entry.key}:${index}`}
            id={entry.id}
            index={index}
            list="experience"
            label={`job ${index + 1}`}
            onMove={entries.move}
            disabled={entries.locked(entry.id)}
            className={entryClass}
          >
            {(handle) => (
              <ExperienceEntry
                index={index}
                id={entry.id}
                controls={
                  <>
                    {handle}
                    <RemoveItemButton
                      label={`job ${index + 1}`}
                      onRemove={() => entries.remove(index)}
                      disabled={entries.locked(entry.id)}
                    />
                  </>
                }
              />
            )}
          </SortableItem>
        ))}
      </ul>
      <AddItemButton onClick={() => entries.add(newExperience())} disabled={entries.locked()}>
        Add job
      </AddItemButton>
    </SectionFrame>
  );
}

export function EducationEditor() {
  const entries = useListEditor('education', 'education', 'Education entry');
  return (
    <SectionFrame path="education" title="Education">
      {entries.items.length === 0 && <Empty text="No education yet." />}
      <ul className="flex flex-col gap-3" aria-label="Education">
        {entries.items.map((entry, index) => (
          <SortableItem
            key={entry.key}
            id={entry.id}
            index={index}
            list="education"
            label={`education entry ${index + 1}`}
            onMove={entries.move}
            disabled={entries.locked(entry.id)}
            className={entryClass}
          >
            {(handle) => (
              <EducationEntry
                index={index}
                id={entry.id}
                controls={
                  <>
                    {handle}
                    <RemoveItemButton
                      label={`education entry ${index + 1}`}
                      onRemove={() => entries.remove(index)}
                      disabled={entries.locked(entry.id)}
                    />
                  </>
                }
              />
            )}
          </SortableItem>
        ))}
      </ul>
      <AddItemButton onClick={() => entries.add(newEducation())} disabled={entries.locked()}>
        Add education
      </AddItemButton>
    </SectionFrame>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground italic">{text}</p>;
}
