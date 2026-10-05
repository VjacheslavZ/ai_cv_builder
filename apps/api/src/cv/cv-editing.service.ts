import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  isFieldPathWithin,
  type CvDocument,
  type PatchCvInput,
  type PatchCvResponse,
} from '@cv/shared';
import { ApiException } from '../common/errors/api.exception.js';
import { ownedOrNotFound } from '../common/ownership/owned.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { CvModel } from '../generated/prisma/models/Cv.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyOps } from './apply-ops.js';
import { CvsRepository } from './cvs.repository.js';

/** The CV row, locked, with a draft to edit; `409 CV_NOT_EDITABLE` before the first draft. */
export function editableDocument(cv: CvModel): CvDocument {
  if (!cv.document) {
    throw new ApiException(ErrorCode.CV_NOT_EDITABLE, 'This CV has no draft to edit yet');
  }
  return cv.document as unknown as CvDocument;
}

/**
 * Open questions whose place was just edited by hand become `resolved` (AC-8.6): the question
 * points at the edited field, inside it, or at a section that contains it.
 */
export async function resolveCoveredQuestions(
  tx: Prisma.TransactionClient,
  cvId: string,
  editedPaths: string[],
): Promise<string[]> {
  const open = await tx.question.findMany({
    where: { cvId, status: 'open' },
    select: { id: true, path: true },
  });
  const covered = open
    .filter((q) =>
      editedPaths.some((p) => isFieldPathWithin(p, q.path) || isFieldPathWithin(q.path, p)),
    )
    .map((q) => q.id);
  if (covered.length > 0) {
    await tx.question.updateMany({ where: { id: { in: covered } }, data: { status: 'resolved' } });
  }
  return covered;
}

/** Manual editing (FR-10): every write takes the CV row lock and bumps `version`, never `aiRevision`. */
@Injectable()
export class CvEditingService {
  private readonly logger = new Logger(CvEditingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cvs: CvsRepository,
  ) {}

  /**
   * AC-10.1, AC-10.4, AC-10.6: ops on top of `baseVersion`. A stale version is `409` with the
   * current state; any invalid op is `400` and nothing changes.
   */
  async patch(id: string, userId: string, input: PatchCvInput): Promise<PatchCvResponse> {
    const result = await this.prisma.$transaction(async (tx) => {
      const cv = ownedOrNotFound(await this.cvs.lockOwned(tx, id, userId));
      const document = editableDocument(cv);
      if (input.baseVersion !== cv.version) {
        throw new ApiException(ErrorCode.VERSION_CONFLICT, 'This CV was changed elsewhere', {
          current: { version: cv.version, document },
        });
      }
      const applied = applyOps(document, input.ops);
      if (!applied.ok) {
        throw new ApiException(ErrorCode.VALIDATION_ERROR, 'Invalid request', {
          fields: applied.fields,
        });
      }
      const updated = await tx.cv.update({
        where: { id },
        data: {
          document: applied.document as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
        select: { version: true },
      });
      const resolvedQuestionIds = await resolveCoveredQuestions(tx, id, applied.touchedPaths);
      return { version: updated.version, resolvedQuestionIds };
    });
    this.logger.log(
      {
        cvId: id,
        version: result.version,
        ops: input.ops.length,
        resolved: result.resolvedQuestionIds.length,
      },
      'CV edited',
    );
    return result;
  }
}
