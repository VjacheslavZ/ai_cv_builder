'use client';

import {
  Accessibility,
  Feedback,
  PointerActivationConstraints,
  PointerSensor,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/dom';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';

/** What every sortable item of the editor carries (`SortableItem`). */
export interface SortableData {
  /** For screen readers: "achievement 2". */
  label: string;
  /** The list's move: the form's field array and its autosave op (`useListEditor`). */
  onMove(from: number, to: number): void;
}

type Source = DragOverEvent['operation']['source'];

const position = (source: Source) => (source && isSortable(source) ? source.index + 1 : null);
const label = (source: Source) => (source?.data as SortableData | undefined)?.label ?? 'item';

/**
 * Drag-to-reorder for every list of the editor (AC-10.2). Each list is its own `type`, so an
 * item never lands in another list. Touch starts after a short hold on the handle, so a quick
 * swipe never drags by mistake; the keyboard sensor (Space, arrows) stays on.
 */
export function SortableLists({ children }: { children: React.ReactNode }) {
  return (
    <DragDropProvider
      sensors={(defaults) => [
        ...defaults.filter((sensor) => sensor !== PointerSensor),
        PointerSensor.configure({
          activationConstraints: (event) =>
            event.pointerType === 'touch'
              ? [new PointerActivationConstraints.Delay({ value: 150, tolerance: 8 })]
              : undefined,
        }),
      ]}
      plugins={(defaults) => [
        // The item snaps into place on drop: the drop animation waits for animation frames,
        // which a hidden tab never gets, leaving its placeholder on screen until it is shown.
        ...defaults.filter((plugin) => plugin !== Feedback),
        Feedback.configure({ dropAnimation: null }),
        Accessibility.configure({
          announcements: {
            dragstart: ({ operation: { source } }: DragStartEvent) => `Picked up ${label(source)}.`,
            dragover: ({ operation: { source } }: DragOverEvent) =>
              position(source) ? `Moved to position ${position(source)}.` : undefined,
            dragend: ({ operation: { source }, canceled }: DragEndEvent) =>
              canceled
                ? 'Reordering cancelled.'
                : `Dropped ${label(source)} at position ${position(source)}.`,
          },
        }),
      ]}
      onDragEnd={(event) => {
        const { source } = event.operation;
        if (event.canceled || !isSortable(source)) return;
        const { initialIndex, index, initialGroup, group } = source;
        if (initialGroup !== group || initialIndex === index) return;
        (source.data as SortableData).onMove(initialIndex, index);
      }}
    >
      {children}
    </DragDropProvider>
  );
}
