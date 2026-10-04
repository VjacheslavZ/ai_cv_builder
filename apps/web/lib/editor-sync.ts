import { getField, parseFieldPath, setField, type CvDocument, type CvSection } from '@cv/shared';

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

/** `server` with the local value of every unsaved field put back (a conflict keeps your text). */
export function overlayUnsaved(
  server: CvDocument,
  local: CvDocument,
  unsavedPaths: string[],
): CvDocument {
  const next = structuredClone(server);
  for (const path of unsavedPaths) {
    const value = getField(local, path);
    if (value !== undefined) setField(next, path, structuredClone(value));
  }
  return next;
}
