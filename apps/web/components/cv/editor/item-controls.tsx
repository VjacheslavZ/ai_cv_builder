'use client';

import { PlusIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** Removes one list item (AC-10.2); reordering is by dragging (`SortableItem`). */
export function RemoveItemButton(props: { label: string; onRemove(): void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-11 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={`Remove ${props.label}`}
      disabled={props.disabled}
      onClick={props.onRemove}
    >
      <XIcon aria-hidden />
    </Button>
  );
}

/** "Add achievement", "Add job", …: appends an empty item (AC-10.2). */
export function AddItemButton(props: { children: string; onClick(): void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 self-start sm:h-9"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <PlusIcon aria-hidden />
      {props.children}
    </Button>
  );
}
