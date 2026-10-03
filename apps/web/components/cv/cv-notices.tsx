import { CircleAlertIcon, TriangleAlertIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** Non-fatal input problems stored on the CV, so every device shows them (AC-4.3). */
export function CvWarnings({ warnings }: { warnings: { code: string; message: string }[] }) {
  return warnings.map((warning) => (
    <p
      key={warning.code}
      className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      {warning.message}
    </p>
  ));
}

/** The reason in plain language and a Retry button (AC-5.6). */
export function GenerationFailed({ message }: { message: string | null }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4" role="alert">
      <p className="flex gap-2 font-medium text-destructive">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Generation failed
      </p>
      <p className="text-sm">{message ?? 'Something went wrong while generating your CV.'}</p>
      {/* Retry on the saved source arrives with Phase 5. */}
      <Button variant="outline" className="h-11 self-start" disabled>
        Retry
      </Button>
    </div>
  );
}
