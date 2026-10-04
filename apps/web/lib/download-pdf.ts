import type { Autosave } from './autosave';

/** The PDF export, through the same-origin `/api/*` rewrite. */
export function pdfUrl(cvId: string): string {
  return `/api/cvs/${cvId}/pdf`;
}

/**
 * "Download PDF" (FR-11): wait for autosave to finish, so the server renders what is on screen
 * (AC-11.3), then navigate to the PDF. A plain navigation, not a blob: iOS Safari and Android
 * Chrome open their own viewer for an `attachment` response (AC-11.6), and no PDF code ships to
 * the client (NFR-M7). `false` when the changes could not be saved: nothing is downloaded.
 */
export async function downloadPdf(
  autosave: Pick<Autosave, 'whenSaved'>,
  cvId: string,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): Promise<boolean> {
  if (!(await autosave.whenSaved())) return false;
  navigate(pdfUrl(cvId));
  return true;
}
