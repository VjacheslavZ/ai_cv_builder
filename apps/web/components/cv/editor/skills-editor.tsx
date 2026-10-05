'use client';

import { fieldValueSchema } from '@cv/shared';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { newSkill } from '@/lib/list-items';
import { EditableField } from './editable-field';
import { RemoveItemButton } from './item-controls';
import { SectionFrame } from './section-frame';
import { SortableItem } from './sortable-item';
import { useListEditor } from './use-list-editor';

export function SkillsEditor() {
  const skills = useListEditor('skills', 'skills');
  return (
    <SectionFrame path="skills" title="Skills">
      {skills.items.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No skills yet.</p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Skills">
        {skills.items.map((skill, index) => (
          <SortableItem
            key={skill.key}
            id={skill.id}
            index={index}
            list="skills"
            label={`skill ${index + 1}`}
            onMove={skills.move}
            disabled={skills.locked(skill.id)}
            className="flex items-start gap-1"
          >
            {(handle) => (
              <>
                <EditableField
                  name={`skills.${index}.name`}
                  path={`skills.${skill.id}`}
                  label={`Skill ${index + 1}`}
                  hideLabel
                  className="flex-1"
                  endAdornment={handle}
                />
                <RemoveItemButton
                  label={`skill ${index + 1}`}
                  onRemove={() => skills.remove(index)}
                  disabled={skills.locked(skill.id)}
                />
              </>
            )}
          </SortableItem>
        ))}
      </ul>
      <AddSkillForm onAdd={(name) => skills.add(newSkill(name))} disabled={skills.locked()} />
    </SectionFrame>
  );
}

/** A skill cannot be empty, so it is typed first and added with its name (AC-10.2). */
function AddSkillForm({ onAdd, disabled }: { onAdd(name: string): void; disabled: boolean }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const add = () => {
    const parsed = fieldValueSchema(`skills.${crypto.randomUUID()}`)!.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid skill');
      return;
    }
    onAdd(parsed.data as string);
    setName('');
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="sr-only">
        New skill
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={name}
          placeholder="Add a skill"
          maxLength={100}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            // Inside the editor's form: Enter adds the skill instead of submitting.
            if (e.key !== 'Enter') return;
            e.preventDefault();
            add();
          }}
          className="h-11 flex-1 text-base sm:max-w-xs"
        />
        <Button type="button" variant="outline" className="h-11" disabled={disabled} onClick={add}>
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
