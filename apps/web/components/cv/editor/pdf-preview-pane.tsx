'use client';

import { cn } from 'cn';
import { useEffect, useRef, useState } from 'react';

import type { Autosave } from '@/lib/autosave';
import { PdfPreview, type PreviewState, type PreviewStatus } from '@/lib/pdf-preview';
import { fetchPdfPreview } from '@/lib/queries/cvs';

/** Some browsers never fire `load` for a PDF in a frame: show it after this anyway. */
const LOAD_FALLBACK_MS = 4_000;
/** The built-in viewer: fit the page width, no thumbnail sidebar in a narrow column. */
const VIEWER_PARAMS = '#view=FitH&navpanes=0';

const STATUS_TEXT: Record<PreviewStatus, string | null> = {
  idle: null,
  loading: 'Updating preview…',
  paused: 'Preview paused for a moment. Your changes are saved.',
  error: 'Could not update the preview. Download PDF still works.',
};

/**
 * The live preview (AC-11.7): the saved PDF, rendered by the server, in the browser's own
 * viewer. A new version loads in a hidden frame and replaces the visible one once loaded, so
 * the previous page stays on screen meanwhile (`lib/pdf-preview.ts` decides when).
 */
export function PdfPreviewPane({ cvId, autosave }: { cvId: string; autosave: Autosave }) {
  const [state, setState] = useState<PreviewState>({ shown: null, incoming: null, status: 'idle' });
  const preview = useRef<PdfPreview | null>(null);

  useEffect(() => {
    const instance = new PdfPreview({
      fetchPdf: (signal) => fetchPdfPreview(cvId, signal),
      toUrl: (blob) => URL.createObjectURL(blob),
      revoke: (url) => URL.revokeObjectURL(url),
    });
    preview.current = instance;
    const unsubscribe = instance.subscribe(() => setState(instance.getState()));
    const push = () => {
      const { version, status } = autosave.getState();
      instance.update(version, status === 'idle' || status === 'saved');
    };
    const unwatch = autosave.subscribe(push);
    push();
    return () => {
      unwatch();
      unsubscribe();
      instance.dispose();
      preview.current = null;
    };
  }, [autosave, cvId]);

  const incoming = state.incoming?.url;
  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(() => preview.current?.displayed(incoming), LOAD_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [incoming]);

  const text = STATUS_TEXT[state.status] ?? (state.shown ? null : 'Loading preview…');
  return (
    <section aria-label="PDF preview" className="flex h-full min-h-0 flex-col gap-2">
      <p aria-live="polite" className="min-h-5 text-xs text-muted-foreground">
        {text}
      </p>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted">
        {[state.shown, state.incoming].map(
          (pdf) =>
            pdf && (
              <iframe
                key={pdf.url}
                src={`${pdf.url}${VIEWER_PARAMS}`}
                title="CV preview (PDF)"
                onLoad={() => preview.current?.displayed(pdf.url)}
                className={cn('absolute inset-0 size-full', pdf.url === incoming && 'invisible')}
              />
            ),
        )}
      </div>
    </section>
  );
}
