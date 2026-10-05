'use client';

import { newBullet } from '@/lib/list-items';
import { DatesField } from './dates-field';
import { EditableField } from './editable-field';
import { AddItemButton, RemoveItemButton } from './item-controls';
import { FieldAnchor, SectionFrame } from './section-frame';
import { SortableItem } from './sortable-item';
import { useListEditor } from './use-list-editor';

interface ExperienceEntryProps {
  index: number;
  id: string;
  /** The drag handle and "remove" of the whole entry. */
  controls: React.ReactNode;
}

/** One job: company, title, dates, and its bullets, each saved on its own path. */
export function ExperienceEntry({ index, id, controls }: ExperienceEntryProps) {
  const base = `experience.${id}`;
  const bullets = useListEditor(`experience.${index}.bullets`, `${base}.bullets`);

  return (
    <SectionFrame path={base}>
      <div className="flex items-start gap-1">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <EditableField name={`experience.${index}.title`} path={`${base}.title`} label="Title" />
          <FieldAnchor path={`${base}.company`}>
            <EditableField
              name={`experience.${index}.company`}
              path={`${base}.company`}
              label="Company"
            />
          </FieldAnchor>
        </div>
        <div className="flex pt-5">{controls}</div>
      </div>
      <FieldAnchor path={`${base}.dates`}>
        <DatesField name={`experience.${index}.dates`} path={`${base}.dates`} />
      </FieldAnchor>
      <FieldAnchor path={`${base}.bullets`}>
        <ul className="flex flex-col gap-2" aria-label="Achievements">
          {bullets.items.map((bullet, b) => (
            <SortableItem
              key={bullet.key}
              id={bullet.id}
              index={b}
              list={`${base}.bullets`}
              label={`achievement ${b + 1}`}
              onMove={bullets.move}
              disabled={bullets.locked(bullet.id)}
              className="flex items-start gap-1"
            >
              {(handle) => (
                <>
                  <EditableField
                    name={`experience.${index}.bullets.${b}.text`}
                    path={`${base}.bullets.${bullet.id}`}
                    label={`Achievement ${b + 1}`}
                    hideLabel
                    multiline
                    className="flex-1"
                    endAdornment={handle}
                  />
                  <RemoveItemButton
                    label={`achievement ${b + 1}`}
                    onRemove={() => bullets.remove(b)}
                    disabled={bullets.locked(bullet.id)}
                  />
                </>
              )}
            </SortableItem>
          ))}
        </ul>
        {bullets.items.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No achievements yet.</p>
        )}
      </FieldAnchor>
      <AddItemButton onClick={() => bullets.add(newBullet())} disabled={bullets.locked()}>
        Add achievement
      </AddItemButton>
    </SectionFrame>
  );
}
