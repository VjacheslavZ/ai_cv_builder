// The PDF render worker_thread (see cv-pdf-renderer.ts). Kept free of TypeScript-only syntax so
// Node can run the .ts source directly under Vitest.
import { registerHooks } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

/** Tags our result, as in pdf-extract.worker.ts. */
export const PDF_RENDER_RESULT_MESSAGE = 'cv:pdf-render-result';

// Under Vitest this file and its imports are `.ts` sources while the imports say `.js` (as
// everywhere in apps/api): resolve a missing relative `.js` to its `.ts` source.
if (import.meta.url.endsWith('.ts')) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        if (!specifier.startsWith('.') || !specifier.endsWith('.js')) throw err;
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
    },
  });
}

if (parentPort) {
  const port = parentPort;
  const { renderCvPdf } = await import('./cv-pdf-render.js');
  const bytes = await renderCvPdf(workerData.document);
  port.postMessage({ type: PDF_RENDER_RESULT_MESSAGE, bytes }, [bytes.buffer]);
}
