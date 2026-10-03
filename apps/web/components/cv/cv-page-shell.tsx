import Link from 'next/link';

interface CvPageShellProps {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

/** The `/cvs/:id` frame: back link, title, optional status badge. */
export function CvPageShell({ title, badge, children }: CvPageShellProps) {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Your CVs
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 font-heading text-2xl font-semibold break-words">{title}</h1>
          {badge}
        </div>
      </div>
      {children}
    </section>
  );
}
