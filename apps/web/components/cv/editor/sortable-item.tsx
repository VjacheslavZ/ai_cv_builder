'use client';

import { useSortable } from '@dnd-kit/react/sortable';
import { cn } from 'cn';
import { GripVerticalIcon } from 'lucide-react';

import type { SortableData } from './sortable-lists';

interface SortableItemProps extends SortableData {
  id: string;
  index: number;
  /** The list's field path: items move only within it. */
  list: string;
  disabled?: boolean;
  className?: string;
  /** Renders the item; place `handle` where the user grabs it. */
  children(handle: React.ReactNode): React.ReactNode;
}

/**
 * One draggable list item (AC-10.2): dragged only by its handle, so text in the item stays
 * selectable and editable. The handle is a 44 px button; with the keyboard, Space picks the
 * item up, arrows move it, Space drops it, Escape cancels.
 */
export function SortableItem(props: SortableItemProps) {
  const { id, index, list, label, onMove, disabled, className, children } = props;
  const { ref, handleRef, isDragging } = useSortable<SortableData>({
    id,
    index,
    group: list,
    type: list,
    accept: list,
    disabled,
    data: { label, onMove },
  });

  const handle = (
    <button
      ref={handleRef}
      type="button"
      aria-label={`Reorder ${label}`}
      disabled={disabled}
      className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
    >
      <GripVerticalIcon className="size-4" aria-hidden />
    </button>
  );

  return (
    <li
      ref={ref}
      className={cn(
        className,
        isDragging && 'relative z-10 rounded-lg bg-background shadow-lg ring-1 ring-border',
      )}
    >
      {children(handle)}
    </li>
  );
}
