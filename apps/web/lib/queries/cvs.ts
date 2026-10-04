import {
  CV_FILE_FIELD,
  IDEMPOTENCY_KEY_HEADER,
  type CreateCvResponse,
  type CvDetailDto,
  type CvSummaryDto,
  type JobStatusDto,
  type RetryCvResponse,
} from '@cv/shared';
import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '../api-fetch';

/** The dashboard list. */
export const cvsQuery = queryOptions({
  queryKey: ['cvs'],
  queryFn: ({ signal }) => apiFetch<CvSummaryDto[]>('/api/cvs', { signal }),
});

export const cvQuery = (id: string) =>
  queryOptions({
    queryKey: ['cvs', id],
    queryFn: ({ signal }) => apiFetch<CvDetailDto>(`/api/cvs/${id}`, { signal }),
  });

export function fetchJob(id: string, signal?: AbortSignal): Promise<JobStatusDto> {
  return apiFetch<JobStatusDto>(`/api/jobs/${id}`, { signal });
}

export interface CreateCvValues {
  role: string;
  text?: string;
  file?: File | null;
}

/**
 * `POST /api/cvs` as multipart. The same `idempotencyKey` for every retry of one form
 * submission makes a double click or a network retry create one CV (AC-3.4).
 */
export function createCv(
  values: CreateCvValues,
  idempotencyKey: string,
): Promise<CreateCvResponse> {
  const body = new FormData();
  body.set('role', values.role);
  if (values.text) body.set('text', values.text);
  if (values.file) body.set(CV_FILE_FIELD, values.file);
  return apiFetch<CreateCvResponse>('/api/cvs', {
    method: 'POST',
    body,
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });
}

/** A new generation of a failed CV on its saved source (AC-5.6). */
export function retryCv(id: string): Promise<RetryCvResponse> {
  return apiFetch<RetryCvResponse>(`/api/cvs/${id}/retry`, { method: 'POST' });
}

export function deleteCv(id: string): Promise<void> {
  return apiFetch<void>(`/api/cvs/${id}`, { method: 'DELETE' });
}
