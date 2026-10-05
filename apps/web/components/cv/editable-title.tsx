'use client';

import { PencilIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { TitleForm } from './title-form';

/** The CV page heading with inline rename (AC-12.4). */
export function EditableTitle({ cvId, title }: { cvId: string; title: string }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <TitleForm cvId={cvId} title={title} onDone={() => setEditing(false)} />;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <h1 className="min-w-0 font-heading text-2xl font-semibold break-words">{title}</h1>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label="Rename CV"
        onClick={() => setEditing(true)}
      >
        <PencilIcon aria-hidden />
      </Button>
    </div>
  );
}
