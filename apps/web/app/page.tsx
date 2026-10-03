import { LogOutButton } from '@/components/auth/log-out-button';
import { CvList } from '@/components/dashboard/cv-list';

export default function HomePage() {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold">Your CVs</h1>
        <LogOutButton />
      </div>
      <p className="text-muted-foreground">
        Upload a PDF or paste your experience, name the role you are aiming for, and get a CV that
        only states what you can back up.
      </p>
      <CvList />
    </section>
  );
}
