'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cvQuery, cvsQuery, renameCv } from '@/lib/queries/cvs';

/**
 * Renames a CV (AC-12.4), shared by the dashboard and the CV page. The new title goes straight
 * into both caches; the list is refetched, since the rename moved the CV to the top.
 */
export function useRenameCv(cvId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => renameCv(cvId, title),
    onSuccess: ({ title, updatedAt }) => {
      queryClient.setQueryData(cvQuery(cvId).queryKey, (d) => d && { ...d, title, updatedAt });
      queryClient.setQueryData(cvsQuery.queryKey, (list) =>
        list?.map((cv) => (cv.id === cvId ? { ...cv, title, updatedAt } : cv)),
      );
      void queryClient.invalidateQueries({ queryKey: cvsQuery.queryKey, exact: true });
    },
  });
}
