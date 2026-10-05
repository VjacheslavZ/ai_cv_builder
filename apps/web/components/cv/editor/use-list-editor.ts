'use client';

import type { CvDocument } from '@cv/shared';
import { useFieldArray, type FieldArray, type FieldArrayPath } from 'react-hook-form';

import { toast } from '@/components/ui/toast';
import { restoreIndex } from '@/lib/list-items';
import { lockingScope, useEditor } from './editor-context';

type ListName = FieldArrayPath<CvDocument>;
type ListItem<N extends ListName> = FieldArray<CvDocument, N> & { id: string };

const UNDO_MS = 8_000;

/**
 * One editable list of the CV (AC-10.2): the form's field array and its autosave ops, kept in
 * step. `name` is the form's (index-based) name, `path` the list's field path on the server.
 * With `undoLabel`, a removal shows a toast with "Undo", which adds the item back.
 */
export function useListEditor<N extends ListName>(name: N, path: string, undoLabel?: string) {
  const { form, autosave, lockedScopes } = useEditor();
  const array = useFieldArray({ control: form.control, name, keyName: 'key' });
  const items = array.fields as unknown as (ListItem<N> & { key: string })[];

  const insert = (index: number, item: ListItem<N>, shouldFocus: boolean) => {
    array.insert(index, item, { shouldFocus });
    autosave.insert(path, index, item);
  };

  const remove = (index: number) => {
    // The values on screen: `items` keeps the ones from the last array change, not typing.
    const value: unknown = form.getValues(`${name}.${index}` as never);
    const item = structuredClone(value) as ListItem<N>;
    array.remove(index);
    autosave.remove(`${path}.${item.id}`);
    if (!undoLabel) return;
    const id = toast.add({
      title: `${undoLabel} removed`,
      timeout: UNDO_MS,
      actionProps: {
        children: 'Undo',
        onClick: () => {
          toast.close(id);
          insert(restoreIndex(index, (form.getValues(name) ?? []).length), item, false);
        },
      },
    });
  };

  return {
    items,
    /** Adds `item` at the end and focuses its first field. */
    add: (item: ListItem<N>) => insert(items.length, item, true),
    remove,
    move: (from: number, to: number) => {
      const id = items[from]!.id;
      array.move(from, to);
      autosave.move(`${path}.${id}`, to);
    },
    /** The AI is rewriting the list (or the item): no structural changes until it is done. */
    locked: (itemId?: string) => !!lockingScope(lockedScopes, itemId ? `${path}.${itemId}` : path),
  };
}
