import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toast';
import { Providers } from './providers';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'AI CV Builder',
  description: 'Turn your experience into a grounded, role-targeted CV.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets content reach the screen edges; the shell pads by the safe-area insets instead.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn('font-sans antialiased', 'font-sans', geist.variable)}>
      <body className="min-h-dvh">
        <div className="mx-auto flex min-h-dvh w-full max-w-screen-lg flex-col pt-[env(safe-area-inset-top)] pr-[max(1rem,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[max(1rem,env(safe-area-inset-left))]">
          <header className="flex h-14 items-center border-b">
            <Link href="/" className="font-heading text-base font-semibold">
              AI CV Builder
            </Link>
          </header>
          <main className="flex flex-1 flex-col py-6">
            <Providers>{children}</Providers>
          </main>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
