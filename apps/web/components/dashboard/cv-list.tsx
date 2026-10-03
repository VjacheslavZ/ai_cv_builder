'use client';

import type { CvSummaryDto } from '@cv/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { CvStatusBadge } from '@/components/cv/cv-status-badge';
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

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function questionsLabel(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? '1 open question' : `${count} open questions`;
}

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
        {data.map((cv) => {
          const questions = questionsLabel(cv.openQuestions);
          return (
            <li key={cv.id} className="flex items-center gap-2 p-2 pl-4">
              <Link
                href={`/cvs/${cv.id}`}
                className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-1 rounded-md py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="truncate font-medium">{cv.title}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <CvStatusBadge status={cv.status} />
                  {questions && <span>{questions}</span>}
                  <time dateTime={cv.updatedAt}>{dateFormat.format(new Date(cv.updatedAt))}</time>
                </span>
              </Link>
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11"
                aria-label={`Delete ${cv.title}`}
                onClick={() => setToDelete(cv)}
              >
                <Trash2Icon />
              </Button>
            </li>
          );
        })}
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
