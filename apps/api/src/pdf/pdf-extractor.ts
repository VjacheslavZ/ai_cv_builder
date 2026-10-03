import { Worker } from 'node:worker_threads';
import { Injectable, Logger } from '@nestjs/common';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import type { PdfExtractInput, PdfExtractOutput } from './pdf-extract.worker.js';

/** Same value as `PDF_RESULT_MESSAGE` in the worker (not imported: that would load pdf.js here). */
const RESULT_MESSAGE = 'cv:pdf-extract-result';
const PDF_ERROR_CODES = new Set(['PDF_ENCRYPTED', 'PDF_CORRUPTED', 'PDF_TOO_MANY_PAGES']);

function isResult(message: unknown): message is { type: string; output: PdfExtractOutput } {
  const m = message as { type?: unknown; output?: Partial<PdfExtractOutput> } | null;
  if (m?.type !== RESULT_MESSAGE || !m.output) return false;
  const out = m.output as { ok?: unknown; text?: unknown; code?: unknown };
  return out.ok === true ? typeof out.text === 'string' : PDF_ERROR_CODES.has(String(out.code));
}

export type PdfExtraction = PdfExtractOutput;

// The compiled worker is `.js` next to this file; under Vitest the source is `.ts`, which Node
// runs directly (type stripping).
const WORKER_URL = new URL(
  `./pdf-extract.worker${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`,
  import.meta.url,
);

/** Letters and digits: whitespace, punctuation, and layout junk do not make a text layer. */
export function countMeaningfulChars(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

/**
 * PDF text extraction in a `worker_thread` with a memory cap and a hard timeout
 * (`terminate()` on expiry), so a corrupted, huge, or hostile file fails the stage in bounded
 * time and never crashes or blocks the worker process (AC-4.4, NFR-S5).
 */
@Injectable()
export class PdfExtractor {
  private readonly logger = new Logger(PdfExtractor.name);

  constructor(@InjectConfig() private readonly config: AppConfig) {}

  extract(bytes: Uint8Array): Promise<PdfExtraction> {
    const { maxPages, workerMaxMemoryMb } = this.config.pdf;
    const workerData: PdfExtractInput = { bytes, maxPages };

    return new Promise<PdfExtraction>((resolve) => {
      const worker = new Worker(WORKER_URL, {
        workerData,
        resourceLimits: { maxOldGenerationSizeMb: workerMaxMemoryMb, maxYoungGenerationSizeMb: 32 },
        stdout: true,
        stderr: true,
      });
      let settled = false;
      const finish = (result: PdfExtraction, reason?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (reason) this.logger.warn({ reason }, 'PDF extraction failed');
        void worker.terminate();
        resolve(result);
      };
      const timer = setTimeout(
        () => finish({ ok: false, code: 'PDF_CORRUPTED' }, 'timeout'),
        this.config.timeouts.pdfExtractionMs,
      );
      worker.on('message', (message: unknown) => {
        if (isResult(message)) finish(message.output);
      });
      // Out of memory (ERR_WORKER_OUT_OF_MEMORY) or a crash inside pdf.js.
      worker.once('error', (err: Error & { code?: string }) =>
        finish({ ok: false, code: 'PDF_CORRUPTED' }, err.code ?? err.name),
      );
      worker.once('exit', (code) => finish({ ok: false, code: 'PDF_CORRUPTED' }, `exit ${code}`));
    });
  }
}
