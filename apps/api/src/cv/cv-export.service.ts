import { Injectable } from '@nestjs/common';
import { ErrorCode, type CvDocument } from '@cv/shared';
import { ApiException } from '../common/errors/api.exception.js';
import { ownedOrNotFound } from '../common/ownership/owned.js';
import { contentDisposition, pdfFileName } from '../pdf/cv-pdf-format.js';
import { CvPdfRenderer, PdfRenderError } from '../pdf/cv-pdf-renderer.js';
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
  ) {}

  /**
   * FR-11: the PDF of the **saved** document, read from the database on every request (AC-11.3),
   * open questions or not (AC-8.3). Any CV with a document qualifies: `ready`, or `generating`
   * during a regenerate, which keeps the previous document.
   */
  async pdf(id: string, userId: string): Promise<CvPdf> {
    const cv = ownedOrNotFound(await this.cvs.findOwned(id, userId));
    const document = cv.document as unknown as CvDocument | null;
    if (!document) {
      throw new ApiException(ErrorCode.CV_NOT_EDITABLE, 'This CV has no draft to download yet');
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.renderer.render(document);
    } catch (err) {
      if (!(err instanceof PdfRenderError)) throw err;
      throw new ApiException(ErrorCode.INTERNAL, 'Could not create the PDF. Try again.');
    }
    return { bytes, disposition: contentDisposition(pdfFileName(document.contact.name)) };
  }
}
