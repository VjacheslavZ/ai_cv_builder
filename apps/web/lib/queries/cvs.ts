import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '../api-fetch';

/** The dashboard list. Item type arrives with Phase 2. */
export const cvsQuery = queryOptions({
  queryKey: ['cvs'],
  queryFn: ({ signal }) => apiFetch<unknown[]>('/api/cvs', { signal }),
});
