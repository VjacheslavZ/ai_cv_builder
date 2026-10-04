'use client';

import type { CvSummaryDto } from '@cv/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { ApiRequestError } from '@/lib/api-fetch';
import { cvsQuery, deleteCv } from '@/lib/queries/cvs';
import { CvListItem } from './cv-list-item';

/** The dashboard (AC-12.1): newest first, status, open questions, last change. */
export function CvList() {
  const { data, error, isPending } = useQuery({
    ...cvsQuery,
    // A CV still generating on another device should change status without a reload (AC-5.3).
    refetchInterval: (query) =>
      query.state.data?.some((cv) => cv.status === 'generating') ? 5_000 : false,
  });
  const [toDelete, setToDelete] = useState<CvSummaryDto | null>(null);

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (error) {
    // 401 already redirects to /login (apiFetch).
    if (error instanceof ApiRequestError && error.status === 401) return null;
    return <p className="text-destructive">Could not load your CVs. Reload the page.</p>;
  }
  if (data.length === 0) {
    return <p className="text-muted-foreground">No CVs yet. Create your first one.</p>;
  }

  return (
    <>
      <ul className="flex flex-col divide-y rounded-xl border">
        {data.map((cv) => (
          <CvListItem key={cv.id} cv={cv} onDelete={() => setToDelete(cv)} />
        ))}
      </ul>
      <DeleteCvDialog cv={toDelete} onClose={() => setToDelete(null)} />
    </>
  );
}

function DeleteCvDialog({ cv, onClose }: { cv: CvSummaryDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => deleteCv(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData(cvsQuery.queryKey, (list) => list?.filter((item) => item.id !== id));
      queryClient.removeQueries({ queryKey: ['cvs', id] });
      onClose();
    },
    onError: (error) => {
      // Already gone (deleted on another device): just refresh the list.
      if (error instanceof ApiRequestError && error.status === 404) {
        void queryClient.invalidateQueries({ queryKey: cvsQuery.queryKey });
        onClose();
        return;
      }
      toast.add({ title: 'Could not delete the CV. Try again.', type: 'error' });
    },
  });

  return (
    <Dialog open={cv !== null} onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this CV?</DialogTitle>
          <DialogDescription>
            “{cv?.title}” and everything in it (source text, answers, questions) will be deleted
            permanently.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" className="h-11 sm:h-9" />}>
            Cancel
          </DialogClose>
          <Button
            variant="destructive"
            className="h-11 sm:h-9"
            disabled={remove.isPending}
            onClick={() => cv && remove.mutate(cv.id)}
          >
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
