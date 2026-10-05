import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  createCvSchema,
  CV_FILE_FIELD,
  ErrorCode,
  IDEMPOTENCY_KEY_HEADER,
  idempotencyKeySchema,
  patchCvSchema,
  PDF_MIME_TYPES,
  renameCvSchema,
  type AuthUser,
  type CreateCvResponse,
  type CvDetailDto,
  type CvSummaryDto,
  type PatchCvInput,
  type PatchCvResponse,
  type RenameCvInput,
  type RenameCvResponse,
  type RetryCvResponse,
} from '@cv/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ownedOrNotFound } from '../common/ownership/owned.js';
import { UuidParam } from '../common/http/uuid-param.js';
import { issuesToFields } from '../common/validation/validation.pipe.js';
import { CvEditingService } from './cv-editing.service.js';
import { CvExportService } from './cv-export.service.js';
import { CvsRepository } from './cvs.repository.js';
import { CvsService } from './cvs.service.js';

const PDF_SIGNATURE = Buffer.from('%PDF-');

/** The part of a multer memory-storage file we use. */
interface UploadedPdf {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

function validationError(fields: Record<string, string>): ApiException {
  return new ApiException(ErrorCode.VALIDATION_ERROR, 'Invalid request', { fields });
}

@Controller('cvs')
export class CvsController {
  constructor(
    private readonly cvs: CvsRepository,
    private readonly service: CvsService,
    private readonly editing: CvEditingService,
    private readonly exporter: CvExportService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<CvSummaryDto[]> {
    return this.cvs.listOwned(user.id);
  }

  /**
   * Multipart `role`, `text?`, `file?` (+ `Idempotency-Key`) → `202 { cvId, jobId }`.
   * Multer (memory storage, limits from MulterModule) answers `413` for an oversized file.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor(CV_FILE_FIELD))
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: Record<string, unknown> | undefined,
    @UploadedFile() file: UploadedPdf | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
  ): Promise<CreateCvResponse> {
    const key =
      idempotencyKey === undefined ? undefined : idempotencyKeySchema.safeParse(idempotencyKey);
    if (key && !key.success) {
      throw validationError({ [IDEMPOTENCY_KEY_HEADER]: key.error.issues[0]!.message });
    }

    // Fields only from the schema: anything else in the body (userId, ownerId) is dropped.
    const input = createCvSchema.safeParse({ role: body?.role, text: body?.text, file });
    if (!input.success) throw validationError(issuesToFields(input.error.issues));

    if (file) {
      const mimeOk = (PDF_MIME_TYPES as readonly string[]).includes(file.mimetype);
      if (!mimeOk || !file.buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
        throw new ApiException(ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'The file is not a PDF');
      }
    }

    return this.service.create({
      userId: user.id,
      role: input.data.role,
      text: input.data.text,
      pdf: file?.buffer,
      idempotencyKey: key?.data,
    });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<CvDetailDto> {
    return this.service.get(id, user.id);
  }

  /**
   * FR-11: the saved document as an A4 PDF, `attachment` so phones open the native viewer
   * (AC-11.6). `no-store`: it is personal and must reflect the latest save (AC-11.3).
   */
  @Get(':id/pdf')
  @Header('Cache-Control', 'no-store')
  async pdf(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<StreamableFile> {
    const { bytes, disposition } = await this.exporter.pdf(id, user.id);
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition,
      length: bytes.length,
    });
  }

  /**
   * AC-11.7: the same PDF for the editor's live preview, `inline`. The only response the web
   * origin may frame: these headers replace helmet's `frame-ancestors 'none'` / `DENY` for this
   * route (`next.config.ts` leaves the path out of its own `'none'`).
   */
  @Get(':id/pdf/preview')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Security-Policy', "frame-ancestors 'self'")
  @Header('X-Frame-Options', 'SAMEORIGIN')
  async pdfPreview(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<StreamableFile> {
    const bytes = await this.exporter.preview(id, user.id);
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition: 'inline',
      length: bytes.length,
    });
  }

  /** AC-5.6: `202 { cvId, jobId }`, a new generation of a failed CV on its saved source. */
  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<RetryCvResponse> {
    return this.service.retry(id, user.id);
  }

  /** Autosave (AC-10.1): `{ baseVersion, ops }` → `{ version }`; `409` with `current` when stale. */
  @Patch(':id')
  patch(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @Body({ schema: patchCvSchema }) body: PatchCvInput,
  ): Promise<PatchCvResponse> {
    return this.editing.patch(id, user.id, body);
  }

  /** AC-12.4: `{ title }` (1–100 characters) → `{ title, updatedAt }`. */
  @Patch(':id/title')
  async rename(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @Body({ schema: renameCvSchema }) body: RenameCvInput,
  ): Promise<RenameCvResponse> {
    return ownedOrNotFound(await this.cvs.renameOwned(id, user.id, body.title));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<void> {
    return this.service.delete(id, user.id);
  }
}
