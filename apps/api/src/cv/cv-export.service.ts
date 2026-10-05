import { Injectable } from '@nestjs/common';
import { ErrorCode, type CvDocument } from '@cv/shared';
import { ApiException } from '../common/errors/api.exception.js';
import { ownedOrNotFound } from '../common/ownership/owned.js';
import { contentDisposition, pdfFileName } from '../pdf/cv-pdf-format.js';
import { CvPdfRenderer, PdfRenderError } from '../pdf/cv-pdf-renderer.js';
import { GenerationLimits } from '../rate-limit/generation-limits.js';
import { CvsRepository } from './cvs.repository.js';

export interface CvPdf {
  bytes: Uint8Array;
  disposition: string;
}

@Injectable()
export class CvExportService {
  constructor(
    private readonly cvs: CvsRepository,
    private readonly renderer: CvPdfRenderer,
    private readonly limits: GenerationLimits,
  ) {}

  /**
   * FR-11: the PDF of the **saved** document, read from the database on every request (AC-11.3),
   * open questions or not (AC-8.3). Any CV with a document qualifies: `ready`, or `generating`
   * during a regenerate, which keeps the previous document.
   */
  async pdf(id: string, userId: string): Promise<CvPdf> {
    const document = await this.savedDocument(id, userId);
    const bytes = await this.render(document);
    return { bytes, disposition: contentDisposition(pdfFileName(document.contact.name)) };
  }

  /**
   * AC-11.7: the same PDF for the live preview, shown inline. Counted per user per minute
   * (NFR-S9) after the ownership and document checks, so a `404` or `409` costs nothing.
   */
  async preview(id: string, userId: string): Promise<Uint8Array> {
    const document = await this.savedDocument(id, userId);
    await this.limits.consumePdfPreview(userId);
    return this.render(document);
  }

  private async savedDocument(id: string, userId: string): Promise<CvDocument> {
    const cv = ownedOrNotFound(await this.cvs.findOwned(id, userId));
    const document = cv.document as unknown as CvDocument | null;
    if (!document) {
      throw new ApiException(ErrorCode.CV_NOT_EDITABLE, 'This CV has no draft to download yet');
    }
    return document;
  }

  private async render(document: CvDocument): Promise<Uint8Array> {
    try {
      return await this.renderer.render(document);
    } catch (err) {
      if (!(err instanceof PdfRenderError)) throw err;
      throw new ApiException(ErrorCode.INTERNAL, 'Could not create the PDF. Try again.');
    }
  }
}
