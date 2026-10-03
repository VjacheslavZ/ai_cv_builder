import { ErrorCode } from '@cv/shared';
import { ApiRequestError } from './api-fetch';

/** The New CV form's values. */
export interface NewCvValues {
  role: string;
  text: string;
  file: File | null;
}

export type NewCvErrorTarget = keyof NewCvValues | 'root';

const FIELD_NAMES = new Set<string>(['role', 'text', 'file']);
const isFieldName = (name: string): name is keyof NewCvValues => FIELD_NAMES.has(name);

/**
 * Where a failed `POST /api/cvs` shows up in the form: `400` field errors on their fields
 * (AC-3.2), `413` / `415` on the file, anything else above the submit button.
 */
export function createCvErrors(error: unknown): [NewCvErrorTarget, string][] {
  if (!(error instanceof ApiRequestError)) return [['root', 'Something went wrong. Try again.']];

  const fields = Object.entries(error.fields ?? {}).filter(([name]) => isFieldName(name));
  if (fields.length > 0) return fields as [NewCvErrorTarget, string][];

  if (error.code === ErrorCode.PAYLOAD_TOO_LARGE) {
    return [['file', 'The PDF must be 10 MB or smaller']];
  }
  if (error.code === ErrorCode.UNSUPPORTED_MEDIA_TYPE) return [['file', 'This file is not a PDF']];
  return [['root', error.message]];
}
