import { describe, expect, it } from 'vitest';
import { fromDraft, toDraft } from './dates-draft';

describe('dates draft', () => {
  it('round-trips ranges with and without months', () => {
    for (const range of [
      { start: '2019-03', end: 'present' },
      { start: '2015', end: '2019' },
      { start: '2020-01', end: '2021-06' },
    ]) {
      expect(fromDraft(toDraft(range))).toEqual(range);
    }
    expect(fromDraft(toDraft(null))).toBeNull();
  });

  it('is incomplete until there is a start year and an end year or Present', () => {
    const blank = toDraft(null);
    expect(fromDraft({ ...blank, startYear: '201' })).toBeUndefined();
    expect(fromDraft({ ...blank, startYear: '2019' })).toBeUndefined();
    expect(fromDraft({ ...blank, startYear: '2019', present: true })).toEqual({
      start: '2019',
      end: 'present',
    });
    expect(fromDraft({ ...blank, startMonth: '03' })).toBeUndefined();
  });
});
