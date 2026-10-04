import { fileURLToPath } from 'node:url';
import { Font, renderToBuffer } from '@react-pdf/renderer';
import type { CvDocument } from '@cv/shared';
import { cvPdfDocument, PDF_FONT_FAMILY } from './cv-pdf-template.js';

// Runs inside the render worker_thread (cv-pdf-render.worker.ts): react-pdf lays out
// synchronously, a long CV takes seconds, and the API's event loop must stay free (NFR-R4).

// `apps/api/assets/fonts`, two levels up from both `src/pdf` and `dist/pdf`.
const FONTS_DIR = new URL('../../assets/fonts/', import.meta.url);
const font = (file: string) => fileURLToPath(new URL(file, FONTS_DIR));

let fontsRegistered = false;

/** Noto Sans (Latin Extended, AC-11.4), embedded in every PDF. */
function registerFonts(): void {
  if (fontsRegistered) return;
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: font('NotoSans-Regular.ttf') },
      { src: font('NotoSans-Bold.ttf'), fontWeight: 'bold' },
    ],
  });
  // Whole words only: no hyphens inserted into names, numbers, or technologies.
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

/** A fresh `ArrayBuffer`, so the worker can transfer it instead of copying. */
export async function renderCvPdf(doc: CvDocument): Promise<Uint8Array<ArrayBuffer>> {
  registerFonts();
  return new Uint8Array(await renderToBuffer(cvPdfDocument(doc)));
}
