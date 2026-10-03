import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
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
  PDF_MIME_TYPES,
  type AuthUser,
  type CreateCvResponse,
  type CvDetailDto,
  type CvSummaryDto,
} from '@cv/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { UuidParam } from '../common/http/uuid-param.js';
import { issuesToFields } from '../common/validation/validation.pipe.js';
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<void> {
    return this.service.delete(id, user.id);
  }
}
