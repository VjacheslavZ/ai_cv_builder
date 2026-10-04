import {
  cvDocumentSchema,
  fieldValueSchema,
  isFieldPathWithin,
  setField,
  type CvDocument,
  type PatchOp,
} from '@cv/shared';

export type ApplyOpsResult =
  | { ok: true; document: CvDocument; editedPaths: string[] }
  | { ok: false; fields: Record<string, string> };

/**
 * Applies PATCH ops to a copy of the document (AC-10.1, AC-10.6): every value is checked
 * against its field's schema, every target must exist, and the result must be a valid document.
 * Any failure rejects the whole PATCH (`400`, CV unchanged). Each edited path joins `editedPaths`,
 * so the AI never changes it again (AC-9.3).
 */
export function applyOps(document: CvDocument, ops: PatchOp[]): ApplyOpsResult {
  const next = structuredClone(document);
  const fields: Record<string, string> = {};
  const edited: string[] = [];

  ops.forEach((op, i) => {
    const schema = fieldValueSchema(op.path);
    if (!schema) {
      fields[`ops.${i}.path`] = 'This field cannot be edited';
      return;
    }
    const value = schema.safeParse(op.value);
    if (!value.success) {
      fields[`ops.${i}.value`] = value.error.issues[0]?.message ?? 'Invalid value';
      return;
    }
    if (!setField(next, op.path, value.data)) {
      fields[`ops.${i}.path`] = 'This entry no longer exists';
      return;
    }
    edited.push(op.path);
  });
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  next.editedPaths = addEditedPaths(next.editedPaths, edited);
  const valid = cvDocumentSchema.safeParse(next);
  if (!valid.success) return { ok: false, fields: { ops: 'The CV would become invalid' } };
  return { ok: true, document: valid.data, editedPaths: edited };
}

/** `editedPaths` plus `paths`, without duplicates or paths already covered by another. */
export function addEditedPaths(current: string[], paths: string[]): string[] {
  const all = [...current];
  for (const path of paths) {
    if (!all.some((p) => isFieldPathWithin(path, p))) all.push(path);
  }
  return all;
}
