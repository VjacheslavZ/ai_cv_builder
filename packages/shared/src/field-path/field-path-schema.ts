import { z } from 'zod';
import { isValidFieldPath } from './field-path.js';

/**
 * A field path (`contact.email`, `experience.<id>.bullets.<id>`) or a list/section path
 * (`experience.<id>.bullets`, `education`). See `field-path.ts` for the grammar.
 */
export const fieldPathSchema = z
  .string()
  .max(200)
  .refine(isValidFieldPath, { message: 'Invalid field path' });

export type FieldPath = z.infer<typeof fieldPathSchema>;
