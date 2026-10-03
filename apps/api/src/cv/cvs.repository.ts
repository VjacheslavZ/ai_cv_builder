import { Injectable } from '@nestjs/common';

/** A CV as listed on the dashboard. Its fields arrive with the CV table in Phase 2. */
export type CvSummary = never;

/** Every method takes the session's `userId` (see `common/ownership/owned.ts`). */
@Injectable()
export class CvsRepository {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listOwned(userId: string): Promise<CvSummary[]> {
    // Phase 2: `prisma.cv.findMany({ where: { userId }, ... })`.
    return [];
  }
}
