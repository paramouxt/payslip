import { describe, expect, it } from 'vitest';
import { DomainError } from '../../errors';
import { isoDate } from '../../dates/iso-date';
import { parsePayPeriodScheme, periodsBetween, resolvePeriodFor } from './scheme';

// The Tracsis fortnight, exactly as evidenced by the employer communication of
// 18 Mar 2026: paid every other Wednesday for hours up to the previous
// Tuesday; hours worked 15–28 Apr are paid 6 May; transition override for
// 6–14 Apr paid 22 Apr.
const tracsisScheme = parsePayPeriodScheme({
  version: 1,
  kind: 'FIXED_LENGTH_ANCHORED',
  anchorStart: '2026-04-15',
  anchorSequence: 1,
  lengthDays: 14,
  payDateOffsetDays: 8,
  overrides: [
    { sequence: 0, startDate: '2026-04-06', endDate: '2026-04-14', payDate: '2026-04-22' },
  ],
});

describe('resolvePeriodFor', () => {
  it('reproduces the employer worked example: 15–28 Apr paid 6 May', () => {
    for (const d of ['2026-04-15', '2026-04-20', '2026-04-28']) {
      const span = resolvePeriodFor(tracsisScheme, isoDate(d));
      expect(span).toEqual({
        sequence: 1,
        startDate: '2026-04-15',
        endDate: '2026-04-28',
        payDate: '2026-05-06',
      });
    }
  });

  it('advances to the next fortnight from the boundary day', () => {
    expect(resolvePeriodFor(tracsisScheme, isoDate('2026-04-29'))).toEqual({
      sequence: 2,
      startDate: '2026-04-29',
      endDate: '2026-05-12',
      payDate: '2026-05-20',
    });
  });

  it('resolves far-future dates arithmetically', () => {
    const span = resolvePeriodFor(tracsisScheme, isoDate('2026-12-25'));
    expect(span.sequence).toBe(19);
    expect(span.startDate).toBe('2026-12-23');
    expect(span.endDate).toBe('2027-01-05');
    expect(span.payDate).toBe('2027-01-13');
  });

  it('lets overrides win: the April transition period', () => {
    expect(resolvePeriodFor(tracsisScheme, isoDate('2026-04-10'))).toEqual({
      sequence: 0,
      startDate: '2026-04-06',
      endDate: '2026-04-14',
      payDate: '2026-04-22',
    });
  });

  it('refuses dates whose computed period would collide with an override', () => {
    // 1 Apr is outside the override but its computed fortnight (1–14 Apr)
    // overlaps it — the legacy weekly scheme owned those dates.
    expect(() => resolvePeriodFor(tracsisScheme, isoDate('2026-04-01'))).toThrow(DomainError);
  });
});

describe('periodsBetween', () => {
  it('returns contiguous periods covering the range', () => {
    const spans = periodsBetween(tracsisScheme, isoDate('2026-04-15'), isoDate('2026-06-01'));
    expect(spans.map((s) => s.sequence)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < spans.length; i++) {
      const prev = spans[i - 1]!;
      const curr = spans[i]!;
      expect(curr.startDate > prev.endDate).toBe(true);
    }
  });

  it('rejects an inverted range', () => {
    expect(() =>
      periodsBetween(tracsisScheme, isoDate('2026-05-01'), isoDate('2026-04-01'))
    ).toThrow(DomainError);
  });
});

describe('parsePayPeriodScheme', () => {
  it('rejects malformed documents', () => {
    expect(() => parsePayPeriodScheme({ version: 1, kind: 'FIXED_LENGTH_ANCHORED' })).toThrow(
      DomainError
    );
    expect(() =>
      parsePayPeriodScheme({
        version: 1,
        kind: 'FIXED_LENGTH_ANCHORED',
        anchorStart: 'not-a-date',
        anchorSequence: 1,
        lengthDays: 14,
        payDateOffsetDays: 8,
      })
    ).toThrow(DomainError);
  });
});
