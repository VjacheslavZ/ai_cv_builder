'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiRequestError } from '@/lib/api-fetch';
import { cvsQuery } from '@/lib/queries/cvs';

/** Placeholder until Phase 2: proves the session works by calling a protected endpoint. */
export function CvList() {
  const { data, error, isPending } = useQuery(cvsQuery);

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (error) {
    // 401 already redirects to /login (apiFetch).
    if (error instanceof ApiRequestError && error.status === 401) return null;
    return <p className="text-destructive">Could not load your CVs. Reload the page.</p>;
  }
  return (
    <p className="text-muted-foreground">
      {data.length === 0 ? 'No CVs yet.' : `${data.length} CVs`}
    </p>
  );
}
