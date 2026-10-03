// Runs inside a worker_thread (see pdf-extractor.ts), so a slow or hostile PDF never blocks the
// worker's event loop and BullMQ keeps renewing its locks. Kept free of TypeScript-only syntax
// so Node can also run the .ts source directly (unit and integration tests).
import { parentPort, workerData } from 'node:worker_threads';
import { extractText, getDocumentProxy } from 'unpdf';

export interface PdfExtractInput {
  bytes: Uint8Array;
  maxPages: number;
}

/** Tags our result: pdf.js may post its own messages on `parentPort` inside a worker thread. */
export const PDF_RESULT_MESSAGE = 'cv:pdf-extract-result';

export type PdfExtractOutput =
  | { ok: true; text: string; pages: number }
  | { ok: false; code: 'PDF_ENCRYPTED' | 'PDF_CORRUPTED' | 'PDF_TOO_MANY_PAGES' };

async function run(input: PdfExtractInput): Promise<PdfExtractOutput> {
  let pdf;
  try {
    // verbosity 0: pdf.js would otherwise print warnings about the (untrusted) file.
    pdf = await getDocumentProxy(input.bytes, { verbosity: 0 });
  } catch (err) {
    const name = (err as { name?: unknown } | null)?.name;
    return { ok: false, code: name === 'PasswordException' ? 'PDF_ENCRYPTED' : 'PDF_CORRUPTED' };
  }
  try {
    if (pdf.numPages > input.maxPages) return { ok: false, code: 'PDF_TOO_MANY_PAGES' };
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return { ok: true, text, pages: totalPages };
  } catch {
    return { ok: false, code: 'PDF_CORRUPTED' };
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

if (parentPort) {
  const port = parentPort;
  void run(workerData as PdfExtractInput).then((output) =>
    port.postMessage({ type: PDF_RESULT_MESSAGE, output }),
  );
}
