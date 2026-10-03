import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';

/**
 * The only error body the API ever sends. `fields` maps an input path (e.g. `role`,
 * `ops.0.value`) to a human-readable message, for `400 VALIDATION_ERROR`.
 */
export interface ApiError {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
}

export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
