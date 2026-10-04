import { z } from 'zod';
import { fieldPathSchema } from '../field-path/field-path-schema.js';
import type { CvDocument } from './document.js';

/** At most this many ops per PATCH: autosave sends the dirty fields of ~1 s of typing. */
export const PATCH_OPS_MAX = 100;

/**
 * One change. Only `set` on an editable field exists in P0; `insert` / `remove` / `move`
 * (Phase 7) join this union. The value is checked per path with `fieldValueSchema`.
 */
export const patchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), path: fieldPathSchema, value: z.unknown() }),
]);
export type PatchOp = z.infer<typeof patchOpSchema>;

/** `PATCH /api/cvs/:id` (AC-10.1, AC-10.4): ops on top of the version the client last saw. */
export const patchCvSchema = z.object({
  baseVersion: z.number().int().nonnegative(),
  ops: z.array(patchOpSchema).min(1).max(PATCH_OPS_MAX),
});
export type PatchCvInput = z.infer<typeof patchCvSchema>;

export interface PatchCvResponse {
  version: number;
  /** Open questions whose place was edited by hand, now `resolved` (AC-8.6). */
  resolvedQuestionIds: string[];
}

/** The CV as it is now, sent with `409 VERSION_CONFLICT` so the client can rebase (AC-10.4). */
export interface CvConflictState {
  version: number;
  document: CvDocument;
}
