import { z } from 'zod';
import type { ErrorCode } from '../errors/error-codes.js';
import type { JobStatusDto } from '../jobs/index.js';
import type { QuestionDto } from '../questions/index.js';
import type { CvDocument } from './document.js';

// Input limits are part of the contract (AC-3.3, NFR-S4): the form and the API enforce the same.
export const ROLE_MAX_LENGTH = 100;
export const SOURCE_TEXT_MAX_LENGTH = 20_000;
export const PDF_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_MAX_PAGES = 10;
export const PDF_MIME_TYPES = ['application/pdf', 'application/x-pdf'] as const;

/** The multipart field the PDF travels in. */
export const CV_FILE_FIELD = 'file';
/** Header for safe retries of `POST /api/cvs` (AC-3.4). */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const idempotencyKeySchema = z
  .string()
  .regex(/^[\w-]{8,128}$/, 'Use 8–128 letters, digits, "-" or "_"');

/** Duck-typed so the same schema checks a browser `File` and a multer upload. */
interface UploadedFileLike {
  size: number;
}

const isUploadedFile = (value: unknown): value is UploadedFileLike =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as UploadedFileLike).size === 'number';

/**
 * The "New CV" form and the fields of `POST /api/cvs` (multipart: `role`, `text`, `file`).
 * The server also checks the file's size, MIME type, and `%PDF-` signature (413 / 415).
 */
export const createCvSchema = z
  .object({
    role: z
      .string('Enter the role you are aiming for')
      .trim()
      .min(1, 'Enter the role you are aiming for')
      .max(ROLE_MAX_LENGTH, `Use at most ${ROLE_MAX_LENGTH} characters`),
    text: z
      .string()
      .trim()
      .max(
        SOURCE_TEXT_MAX_LENGTH,
        `Use at most ${SOURCE_TEXT_MAX_LENGTH.toLocaleString('en-US')} characters`,
      )
      .optional()
      .transform((text) => (text ? text : undefined)),
    file: z
      .custom<UploadedFileLike>(isUploadedFile, 'Upload a PDF file')
      .refine((file) => file.size > 0, 'The file is empty')
      .refine((file) => file.size <= PDF_MAX_BYTES, 'The PDF must be 10 MB or smaller')
      .nullish(),
  })
  .refine((input) => input.text !== undefined || input.file, {
    message: 'Upload a PDF or paste your experience',
    path: ['text'],
  });

export type CreateCvInput = z.input<typeof createCvSchema>;

/** `202` from `POST /api/cvs`; a replay with the same `Idempotency-Key` gets the same body. */
export interface CreateCvResponse {
  cvId: string;
  jobId: string;
}

export const CV_STATUSES = ['generating', 'ready', 'failed'] as const;
export type CvStatus = (typeof CV_STATUSES)[number];

/** A non-fatal problem with the input, stored on the CV so every device shows it (AC-4.3). */
export interface CvWarning {
  code: 'PDF_NO_TEXT_USED_FREE_TEXT';
  message: string;
}

export const CV_WARNING_MESSAGES: Record<CvWarning['code'], string> = {
  PDF_NO_TEXT_USED_FREE_TEXT:
    'Your PDF looks like a scan, so we used only the text you pasted. Add anything missing by hand.',
};

/** One row of the dashboard (`GET /api/cvs`, AC-12.1), newest first. */
export interface CvSummaryDto {
  id: string;
  title: string;
  status: CvStatus;
  openQuestions: number;
  updatedAt: string;
}

/** `GET /api/cvs/:id`. */
export interface CvDetailDto {
  id: string;
  title: string;
  targetRole: string;
  status: CvStatus;
  failureCode: ErrorCode | null;
  failureMessage: string | null;
  warnings: CvWarning[];
  /** `null` until the first generation completes. */
  document: CvDocument | null;
  version: number;
  questions: QuestionDto[];
  activeJobs: JobStatusDto[];
  /** The newest job of any status: the progress screen falls back to it after a reload. */
  latestJob: JobStatusDto | null;
  createdAt: string;
  updatedAt: string;
}
