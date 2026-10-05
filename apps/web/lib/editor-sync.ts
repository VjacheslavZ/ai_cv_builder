import {
  applyListOp,
  getField,
  parseFieldPath,
  setField,
  type CvDocument,
  type CvSection,
  type PatchOp,
} from '@cv/shared';

// Bringing server changes into the editor without touching what the user is typing (AC-10.4):
// the form takes the changed part from the server and keeps every unsaved local value.

/** The top-level section a path lives in (`experience.<id>.title` → `experience`). */
export function sectionOf(path: string): CvSection | null {
  return parseFieldPath(path)?.section ?? null;
}

/**
 * `local` with the part at `scope` (an entry, a section, or a single field) taken from
 * `server`. Entries are matched by id; a field outside any known entry is left alone.
 */
export function takeScope(local: CvDocument, server: CvDocument, scope: string): CvDocument {
  const next = structuredClone(local);
  const parts = parseFieldPath(scope);
  if (!parts) return next;
  if (getField(server, scope) !== undefined) {
    setField(next, scope, structuredClone(getField(server, scope)));
    return next;
  }
  switch (parts.section) {
    case 'summary':
      next.summary = server.summary;
      break;
    case 'contact':
      next.contact = structuredClone(server.contact);
      break;
    case 'skills':
      next.skills = structuredClone(server.skills);
      break;
    case 'experience':
    case 'education': {
      const key = parts.section;
      if (!parts.entryId) {
        (next[key] as unknown) = structuredClone(server[key]);
        break;
      }
      const entry = (server[key] as { id: string }[]).find((e) => e.id === parts.entryId);
      const list = next[key] as { id: string }[];
      const index = list.findIndex((e) => e.id === parts.entryId);
      if (entry && index >= 0) list[index] = structuredClone(entry);
      break;
    }
  }
  return next;
}

/**
 * `server` with every unsaved change replayed in order (a conflict keeps your text, and the
 * items you added, removed, or moved, AC-10.2). A field takes its value on screen, which may be
 * newer than the queued one; an op that no longer fits the server's state is skipped.
 */
export function overlayUnsaved(
  server: CvDocument,
  local: CvDocument,
  unsavedOps: PatchOp[],
): CvDocument {
  const next = structuredClone(server);
  for (const op of unsavedOps) {
    if (op.op !== 'set') {
      applyListOp(next, structuredClone(op));
      continue;
    }
    const value = getField(local, op.path) ?? op.value;
    if (value !== undefined) setField(next, op.path, structuredClone(value));
  }
  return next;
}
