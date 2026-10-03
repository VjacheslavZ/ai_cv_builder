'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createCvSchema } from '@cv/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';

import { PdfPicker } from '@/components/cv/pdf-picker';
import { SourceTextField } from '@/components/cv/source-text-field';
import { TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createCvErrors, type NewCvValues } from '@/lib/create-cv-errors';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { createCv, cvsQuery } from '@/lib/queries/cvs';

/**
 * Role + PDF and/or pasted text (AC-3.1, NFR-M4). Validated with the API's own schema; server
 * field errors land on the same fields (AC-3.2). One `Idempotency-Key` per form instance, so a
 * double click or a retried request creates a single CV (AC-3.4).
 */
export function NewCvForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [idempotencyKey] = useState(newIdempotencyKey);

  const form = useForm<NewCvValues>({
    resolver: zodResolver(createCvSchema) as unknown as Resolver<NewCvValues>,
    defaultValues: { role: '', text: '', file: null },
  });
  const { errors } = form.formState;
  const file = useWatch({ control: form.control, name: 'file' });

  function setFile(next: File | null) {
    const { isSubmitted } = form.formState;
    form.setValue('file', next, { shouldValidate: isSubmitted, shouldDirty: true });
    // Before the first submit, a chosen file clears the "PDF or text" error right away.
    if (next && !isSubmitted) form.clearErrors(['file', 'text']);
  }

  const create = useMutation({
    mutationFn: (values: NewCvValues) => createCv(values, idempotencyKey),
    onSuccess: ({ cvId }) => {
      void queryClient.invalidateQueries({ queryKey: cvsQuery.queryKey });
      router.push(`/cvs/${cvId}`);
    },
    onError: (error) => {
      for (const [target, message] of createCvErrors(error)) form.setError(target, { message });
    },
  });
  const busy = create.isPending || create.isSuccess;

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={form.handleSubmit((values) => create.mutate(values))}
    >
      <FieldGroup className="gap-6">
        <TextField
          id="role"
          label="Target role"
          placeholder="e.g. Senior Backend Engineer"
          autoComplete="off"
          error={errors.role}
          {...form.register('role')}
        />

        <Field>
          <FieldLabel>Your experience</FieldLabel>
          <FieldDescription>
            Upload your current CV, paste your experience, or both.
          </FieldDescription>
          <Tabs defaultValue="pdf">
            <TabsList className="h-11! w-full sm:w-fit">
              <TabsTrigger value="pdf" className="px-3">
                Upload PDF
              </TabsTrigger>
              <TabsTrigger value="text" className="px-3">
                Paste text
              </TabsTrigger>
            </TabsList>
            <TabsContent value="pdf" className="pt-2">
              <PdfPicker
                file={file}
                invalid={!!errors.file}
                onPick={setFile}
                onRemove={() => setFile(null)}
              />
            </TabsContent>
            <TabsContent value="text" className="pt-2">
              <SourceTextField
                control={form.control}
                invalid={!!errors.text}
                registration={form.register('text')}
              />
            </TabsContent>
          </Tabs>
          <FieldError errors={[errors.file ?? errors.text]} />
        </Field>
      </FieldGroup>

      <div className="flex flex-col gap-2">
        <FieldError errors={[errors.root]} />
        <Button
          type="submit"
          size="lg"
          className="h-11 w-full sm:w-auto sm:self-start"
          disabled={busy}
        >
          {busy ? 'Starting…' : 'Generate'}
        </Button>
      </div>
    </form>
  );
}
