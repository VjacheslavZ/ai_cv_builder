import { TriangleAlertIcon } from 'lucide-react';

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
