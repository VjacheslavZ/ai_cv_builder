import { StandardSchemaValidationPipe } from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { ErrorCode } from '@cv/shared';
import { ApiException } from '../errors/api.exception.js';

function issuePath(issue: StandardSchemaV1.Issue): string {
  return (issue.path ?? [])
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.');
}

/** `{ 'ops.0.value': 'Too long' }` — the first message per path, keyed the way the client sends it. */
export function issuesToFields(issues: readonly StandardSchemaV1.Issue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const path = issuePath(issue);
    if (path && !(path in fields)) fields[path] = issue.message;
  }
  return fields;
}

/**
 * Global pipe for parameters declared with a schema: `@Body({ schema: createCvSchema })`.
 * Shared schemas are `z.object`, which strips unknown keys; `transform: true` hands the
 * handler the parsed (stripped, coerced) value. Failures become `400 VALIDATION_ERROR`.
 */
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    transform: true,
    exceptionFactory: (issues) =>
      new ApiException(ErrorCode.VALIDATION_ERROR, 'Invalid request', {
        fields: issuesToFields(issues),
      }),
  });
}
