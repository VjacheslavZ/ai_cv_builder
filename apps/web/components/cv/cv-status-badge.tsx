import type { CvStatus } from '@cv/shared';
import { cn } from 'cn';

const LABELS: Record<CvStatus, string> = {
  generating: 'Generating',
  ready: 'Ready',
  failed: 'Failed',
};

const STYLES: Record<CvStatus, string> = {
  generating: 'bg-muted text-foreground',
  ready: 'bg-primary/10 text-primary',
  failed: 'bg-destructive/10 text-destructive',
};

export function CvStatusBadge({ status, className }: { status: CvStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium',
        STYLES[status],
        className,
      )}
    >
      {LABELS[status]}
    </span>
  );
}
