import type { CvDateRange } from '@cv/shared';

// The dates control's inputs (month selects, year inputs, "Present") and the `{ start, end }`
// value they stand for. Pure, so the mapping is unit-tested.

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface DatesDraft {
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
  present: boolean;
}

function split(date: string | undefined): { year: string; month: string } {
  const [year = '', month = ''] = (date ?? '').split('-');
  return { year, month };
}

export function toDraft(value: CvDateRange | null): DatesDraft {
  const start = split(value?.start);
  const present = value?.end === 'present';
  const end = split(present ? undefined : value?.end);
  return {
    startMonth: start.month,
    startYear: start.year,
    endMonth: end.month,
    endYear: end.year,
    present,
  };
}

const join = (year: string, month: string) => (month ? `${year}-${month}` : year);

/**
 * The range the inputs describe: `null` when everything is empty, `undefined` while it is
 * incomplete (no 4-digit start year, or neither an end year nor Present). Order and format are
 * checked by the schema afterwards.
 */
export function fromDraft(draft: DatesDraft): CvDateRange | null | undefined {
  const empty =
    !draft.startYear && !draft.startMonth && !draft.endYear && !draft.endMonth && !draft.present;
  if (empty) return null;
  if (!/^\d{4}$/.test(draft.startYear)) return undefined;
  if (draft.present) return { start: join(draft.startYear, draft.startMonth), end: 'present' };
  if (!/^\d{4}$/.test(draft.endYear)) return undefined;
  return {
    start: join(draft.startYear, draft.startMonth),
    end: join(draft.endYear, draft.endMonth),
  };
}
