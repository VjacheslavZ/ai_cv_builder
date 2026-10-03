import type { Metadata } from 'next';
import { CvProgressView } from '@/components/cv/cv-progress-view';

export const metadata: Metadata = { title: 'CV · AI CV Builder' };

export default async function CvPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CvProgressView cvId={id} />;
}
