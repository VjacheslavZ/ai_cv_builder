import { z } from 'zod';
import { fieldPathSchema } from '../field-path/field-path-schema.js';
import type { CvDocument } from './document.js';

/** At most this many ops per PATCH: autosave sends the dirty fields of ~1 s of typing. */
export const PATCH_OPS_MAX = 100;

const index = z.number().int().nonnegative().max(1_000);

/**
 * One change, applied in order (`lists.ts` for the list ops, AC-10.2):
 * - `set`: an editable field; the value is checked per path with `fieldValueSchema`;
 * - `insert`: a new item (with a new id) at `index` of the list at `path`
 *   (`experience`, `education`, `skills`, `experience.<id>.bullets`), checked with `listItemSchema`;
 * - `remove`: the item at `path` (`skills.<id>`, `experience.<id>.bullets.<id>`, …);
 * - `move`: the item at `path` to `index` of its list.
 */
export const patchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), path: fieldPathSchema, value: z.unknown() }),
  z.object({ op: z.literal('insert'), path: fieldPathSchema, index, value: z.unknown() }),
  z.object({ op: z.literal('remove'), path: fieldPathSchema }),
  z.object({ op: z.literal('move'), path: fieldPathSchema, index }),
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
