'use client';

import { DownloadIcon, LoaderCircleIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import type { Autosave } from '@/lib/autosave';
import { downloadPdf } from '@/lib/download-pdf';

/** Saves what is on screen, then downloads the PDF of it (FR-11, AC-11.3). */
export function DownloadPdfButton({ cvId, autosave }: { cvId: string; autosave: Autosave }) {
  const [waiting, setWaiting] = useState(false);

  const onClick = async () => {
    setWaiting(true);
    try {
      const ok = await downloadPdf(autosave, cvId);
      if (!ok) {
        const conflict = autosave.getState().status === 'conflict';
        toast.add({
          title: conflict
            ? 'Resolve the conflict above, then download the PDF.'
            : 'Your latest changes are not saved yet. Check your connection and try again.',
          type: 'error',
        });
      }
    } finally {
      setWaiting(false);
    }
  };

  return (
    <Button className="h-11 sm:h-9" disabled={waiting} onClick={() => void onClick()}>
      {waiting ? (
        <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <DownloadIcon aria-hidden />
      )}
      {waiting ? 'Saving…' : 'Download PDF'}
    </Button>
  );
}
