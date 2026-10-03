'use client';

import { PDF_MAX_BYTES, PDF_MIME_TYPES } from '@cv/shared';
import { cn } from 'cn';
import { FileTextIcon, UploadIcon, XIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PdfPickerProps {
  file: File | null;
  invalid: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}

/**
 * A native file picker behind a Button (iOS and Android pickers), plus a drag-and-drop zone on
 * desktop (NFR-M4). Shows the chosen file with a remove button.
 */
export function PdfPicker({ file, invalid, onPick, onRemove }: PdfPickerProps) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = (picked: File | undefined) => {
    if (picked) onPick(picked);
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={PDF_MIME_TYPES[0]}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {file ? (
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <FileTextIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="size-11"
            aria-label="Remove file"
            onClick={onRemove}
          >
            <XIcon />
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            'flex flex-col items-center gap-3 rounded-lg p-4 text-center md:border md:border-dashed md:p-8',
            dragging && 'md:border-ring md:bg-muted/50',
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pick(event.dataTransfer.files[0]);
          }}
        >
          <p className="hidden text-sm text-muted-foreground md:block">Drop your PDF here, or</p>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full sm:w-auto"
            aria-invalid={invalid || undefined}
            onClick={() => input.current?.click()}
          >
            <UploadIcon data-icon="inline-start" />
            Choose a PDF
          </Button>
          <p className="text-xs text-muted-foreground">
            Up to {formatSize(PDF_MAX_BYTES)} and 10 pages, with selectable text (not a scan).
          </p>
        </div>
      )}
    </>
  );
}
