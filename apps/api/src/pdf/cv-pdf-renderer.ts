import { Worker } from 'node:worker_threads';
import { Injectable, Logger } from '@nestjs/common';
import type { CvDocument } from '@cv/shared';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';

/** Same value as `PDF_RENDER_RESULT_MESSAGE` in the worker (not imported: it would start it). */
const RESULT_MESSAGE = 'cv:pdf-render-result';

const WORKER_URL = new URL(
  `./cv-pdf-render.worker${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`,
  import.meta.url,
);

export class PdfRenderError extends Error {
  constructor(readonly reason: string) {
    super(`PDF rendering failed: ${reason}`);
    this.name = 'PdfRenderError';
  }
}

function isResult(message: unknown): message is { type: string; bytes: Uint8Array } {
  const m = message as { type?: unknown; bytes?: unknown } | null;
  return m?.type === RESULT_MESSAGE && m.bytes instanceof Uint8Array;
}

/**
 * Renders a CV document to PDF in a `worker_thread` with a memory cap and a hard timeout
 * (`terminate()` on expiry, NFR-R4). react-pdf lays out synchronously, and a long CV takes
 * seconds: in-process it would block every other request on the API.
 */
@Injectable()
export class CvPdfRenderer {
  private readonly logger = new Logger(CvPdfRenderer.name);

  constructor(@InjectConfig() private readonly config: AppConfig) {}

  render(document: CvDocument): Promise<Uint8Array> {
    const started = Date.now();
    return new Promise<Uint8Array>((resolve, reject) => {
      const worker = new Worker(WORKER_URL, {
        workerData: { document },
        resourceLimits: {
          maxOldGenerationSizeMb: this.config.pdf.renderMaxMemoryMb,
          maxYoungGenerationSizeMb: 32,
        },
        stdout: true,
        stderr: true,
      });
      let settled = false;
      const finish = (result: Uint8Array | PdfRenderError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (result instanceof PdfRenderError) {
          this.logger.warn({ reason: result.reason }, 'PDF rendering failed');
          reject(result);
        } else {
          this.logger.log(
            { durationMs: Date.now() - started, bytes: result.length },
            'PDF rendered',
          );
          resolve(result);
        }
      };
      const timer = setTimeout(
        () => finish(new PdfRenderError('timeout')),
        this.config.timeouts.pdfRenderMs,
      );
      worker.on('message', (message: unknown) => {
        if (isResult(message)) finish(message.bytes);
      });
      worker.once('error', (err: Error & { code?: string }) =>
        finish(new PdfRenderError(err.code ?? err.name)),
      );
      worker.once('exit', (code) => finish(new PdfRenderError(`exit ${code}`)));
    });
  }
}
