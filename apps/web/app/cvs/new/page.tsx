import type { Metadata } from 'next';
import Link from 'next/link';
import { NewCvForm } from '@/components/cv/new-cv-form';

export const metadata: Metadata = { title: 'New CV · AI CV Builder' };

export default function NewCvPage() {
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Your CVs
        </Link>
        <h1 className="font-heading text-2xl font-semibold">New CV</h1>
      </div>
      <NewCvForm />
    </section>
  );
}
