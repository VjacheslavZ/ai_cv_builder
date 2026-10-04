import { z } from 'zod';
import type { CvConflictState } from '../cv/patch.js';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';

/**
 * The only error body the API ever sends. `fields` maps an input path (e.g. `role`,
 * `ops.0.value`) to a human-readable message, for `400 VALIDATION_ERROR`. `jobId` names the
 * job that already holds the slot, for `409 ACTIVE_JOB_EXISTS` (AC-5.8). `current` is the CV as it
 * is now, for `409 VERSION_CONFLICT` (AC-10.4).
 */
export interface ApiError {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  jobId?: string;
  current?: CvConflictState;
}

export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
  jobId: z.string().optional(),
  // Read back from our own API, so the document is trusted as typed (it was validated on write).
  current: z
    .object({ version: z.number(), document: z.custom<CvConflictState['document']>() })
    .optional(),
});
