import type { z } from 'zod';
import { isFieldPathWithin, parseFieldPath } from '../field-path/field-path.js';
import {
  cvBulletSchema,
  cvEducationSchema,
  cvExperienceSchema,
  cvSkillSchema,
  REMOVED_MAX,
  type CvDocument,
} from './document.js';
import type { PatchOp } from './patch.js';

// The lists a user can add to, remove from, and reorder (AC-10.2), addressed by field path:
//
//   experience | education | skills         → entries / skills
//   experience.<entryId>.bullets            → the bullets of one entry
//
// An item is `<list>.<itemId>`. The server applies `insert` / `remove` / `move` ops with
// `applyListOp`; the web replays its unsaved ops with it after a conflict, so both agree.

export type CvListKind = 'experience' | 'education' | 'skills' | 'bullets';

export interface CvListRef {
  kind: CvListKind;
  /** The entry that owns a bullets list. */
  entryId?: string;
}

interface Item {
  id: string;
}

/** The list at `path`, or `null` when `path` is not a list. */
export function parseListPath(path: string): CvListRef | null {
  const parts = parseFieldPath(path);
  if (!parts) return null;
  if (parts.section === 'skills') return parts.itemId ? null : { kind: 'skills' };
  if (parts.section !== 'experience' && parts.section !== 'education') return null;
  if (!parts.entryId) return { kind: parts.section };
  if (parts.section === 'experience' && parts.field === 'bullets' && !parts.itemId) {
    return { kind: 'bullets', entryId: parts.entryId };
  }
  return null;
}

/** `experience.<id>` → `{ list: 'experience', itemId }`; `null` when `path` is not a list item. */
export function parseItemPath(path: string): { list: string; itemId: string } | null {
  const cut = path.lastIndexOf('.');
  if (cut < 0) return null;
  const list = path.slice(0, cut);
  const itemId = path.slice(cut + 1);
  if (!parseListPath(list) || !parseFieldPath(path)) return null;
  return { list, itemId };
}

/** The schema of a new item of the list at `path` (`insert`), or `null` for a non-list. */
export function listItemSchema(path: string): z.ZodType<Item> | null {
  switch (parseListPath(path)?.kind) {
    case 'experience':
      return cvExperienceSchema;
    case 'education':
      return cvEducationSchema;
    case 'skills':
      return cvSkillSchema;
    case 'bullets':
      return cvBulletSchema;
    default:
      return null;
  }
}

/** The list itself (mutable), or `undefined` when it, or the entry owning it, does not exist. */
export function getList(doc: CvDocument, path: string): Item[] | undefined {
  const ref = parseListPath(path);
  switch (ref?.kind) {
    case 'experience':
    case 'education':
    case 'skills':
      return doc[ref.kind];
    case 'bullets':
      return doc.experience.find((e) => e.id === ref.entryId)?.bullets;
    default:
      return undefined;
  }
}

/**
 * The editable fields of an item (`fields.ts`): what becomes a manual edit when the user adds
 * or moves it. With `nested`, an entry's bullets too.
 */
export function itemFieldPaths(list: string, item: Item, nested = false): string[] {
  const path = `${list}.${item.id}`;
  switch (parseListPath(list)?.kind) {
    case 'experience': {
      const fields = ['company', 'title', 'dates'].map((f) => `${path}.${f}`);
      const bullets = nested ? ((item as { bullets?: Item[] }).bullets ?? []) : [];
      return [...fields, ...bullets.map((b) => `${path}.bullets.${b.id}`)];
    }
    case 'education':
      return ['institution', 'degree', 'dates'].map((f) => `${path}.${f}`);
    case 'skills':
    case 'bullets':
      return [path];
    default:
      return [];
  }
}

/** Lowercase words only: "Mentored 3 junior engineers." and "mentored 3 Junior engineers" match. */
export function normalizeItemText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** What identifies an item of `list` once it is gone: its text, normalized; `''` if it has none. */
export function removedKey(list: string, item: unknown): string {
  const value = item as Record<string, unknown>;
  const text = (...keys: string[]) => keys.map((k) => String(value[k] ?? '')).join(' ');
  switch (parseListPath(list)?.kind) {
    case 'experience':
      return normalizeItemText(text('company', 'title'));
    case 'education':
      return normalizeItemText(text('institution', 'degree'));
    case 'skills':
      return normalizeItemText(text('name'));
    case 'bullets':
      return normalizeItemText(text('text'));
    default:
      return '';
  }
}

/** True when the user removed an item like this one from `list` (`CvDocument.removed`). */
export function isRemovedItem(doc: CvDocument, list: string, item: unknown): boolean {
  const key = removedKey(list, item);
  return key !== '' && (doc.removed ?? []).some((r) => r.list === list && r.key === key);
}

/** `editedPaths` plus `paths`, without duplicates or paths already covered by another. */
export function addEditedPaths(current: string[], paths: string[]): string[] {
  const all = [...current];
  for (const path of paths) {
    if (!all.some((p) => isFieldPathWithin(path, p))) all.push(path);
  }
  return all;
}

function allIds(doc: CvDocument): Set<string> {
  const ids = new Set<string>();
  for (const link of doc.contact.links) ids.add(link.id);
  for (const entry of doc.experience) {
    ids.add(entry.id);
    for (const bullet of entry.bullets) ids.add(bullet.id);
  }
  for (const item of [...doc.education, ...doc.skills]) ids.add(item.id);
  return ids;
}

export type ListOp = Exclude<PatchOp, { op: 'set' }>;

export type ListOpResult =
  | {
      ok: true;
      /** The item the op added or removed (questions inside it are resolved, AC-8.6). */
      touched: string | null;
    }
  | { ok: false; field: 'path' | 'value' | 'index'; message: string };

const fail = (field: 'path' | 'value' | 'index', message: string): ListOpResult => ({
  ok: false,
  field,
  message,
});

/**
 * Applies one `insert` / `remove` / `move` to `doc`, in place (AC-10.2). It keeps the AI rules:
 * - an added or moved item becomes a manual edit (its fields join `editedPaths`), so the AI
 *   neither rewrites it nor moves it back (AC-9.3);
 * - a removed item is remembered in `removed`, so an AI rewrite never adds it back, and its
 *   `editedPaths` go with it; adding the same item again forgets the removal.
 * Nothing is changed when it fails.
 */
export function applyListOp(doc: CvDocument, op: ListOp): ListOpResult {
  if (op.op === 'insert') {
    const schema = listItemSchema(op.path);
    if (!schema) return fail('path', 'Items cannot be added here');
    const parsed = schema.safeParse(op.value);
    if (!parsed.success) return fail('value', parsed.error.issues[0]?.message ?? 'Invalid item');
    const list = getList(doc, op.path);
    if (!list) return fail('path', 'This entry no longer exists');
    if (op.index > list.length) return fail('index', 'This position is outside the list');
    const item = parsed.data;
    if (allIds(doc).has(item.id)) return fail('value', 'This item already exists');
    list.splice(op.index, 0, item);
    doc.editedPaths = addEditedPaths(doc.editedPaths, itemFieldPaths(op.path, item, true));
    const key = removedKey(op.path, item);
    if (doc.removed) doc.removed = doc.removed.filter((r) => r.list !== op.path || r.key !== key);
    return { ok: true, touched: `${op.path}.${item.id}` };
  }

  const target = parseItemPath(op.path);
  const list = target && getList(doc, target.list);
  const index = list?.findIndex((item) => item.id === target!.itemId) ?? -1;
  if (!target || !list) return fail('path', 'This list cannot be edited');
  if (index < 0) return fail('path', 'This item no longer exists');
  const item = list[index]!;

  if (op.op === 'remove') {
    list.splice(index, 1);
    doc.editedPaths = doc.editedPaths.filter((p) => !isFieldPathWithin(p, op.path));
    const key = removedKey(target.list, item);
    if (key) {
      const others = (doc.removed ?? []).filter((r) => r.list !== target.list || r.key !== key);
      doc.removed = [...others, { list: target.list, key }].slice(-REMOVED_MAX);
    }
    return { ok: true, touched: op.path };
  }

  if (op.index >= list.length) return fail('index', 'This position is outside the list');
  list.splice(index, 1);
  list.splice(op.index, 0, item);
  doc.editedPaths = addEditedPaths(doc.editedPaths, itemFieldPaths(target.list, item));
  return { ok: true, touched: null };
}
