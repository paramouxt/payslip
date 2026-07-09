import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  addDays,
  compareIsoDates,
  dayOfWeek,
  diffDays,
  isIsoDate,
  isoDate,
  localDateOf,
} from './iso-date';

describe('isIsoDate', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDate('2026-04-15')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true); // leap year
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('15/04/2026')).toBe(false);
    expect(isIsoDate('2026-4-15')).toBe(false);
  });

  it('isoDate() throws on invalid input', () => {
    expect(() => isoDate('garbage')).toThrow(DomainError);
  });
});

describe('arithmetic', () => {
  it('adds and diffs days, including across month/leap boundaries', () => {
    expect(addDays(isoDate('2026-04-15'), 13)).toBe('2026-04-28');
    expect(addDays(isoDate('2028-02-28'), 1)).toBe('2028-02-29');
    expect(addDays(isoDate('2026-04-15'), -14)).toBe('2026-04-01');
    expect(diffDays(isoDate('2026-04-15'), isoDate('2026-04-28'))).toBe(13);
    expect(diffDays(isoDate('2026-04-28'), isoDate('2026-04-15'))).toBe(-13);
  });

  it('calendar-day arithmetic is immune to DST (clocks change 2026-03-29 UK)', () => {
    expect(diffDays(isoDate('2026-03-28'), isoDate('2026-03-30'))).toBe(2);
    expect(addDays(isoDate('2026-03-28'), 2)).toBe('2026-03-30');
  });

  it('compares chronologically', () => {
    expect(compareIsoDates(isoDate('2026-04-01'), isoDate('2026-04-02'))).toBe(-1);
    expect(compareIsoDates(isoDate('2026-04-02'), isoDate('2026-04-02'))).toBe(0);
  });
});

describe('dayOfWeek', () => {
  it('matches known dates from the employer evidence', () => {
    expect(dayOfWeek(isoDate('2026-04-15'))).toBe('WED'); // period anchor
    expect(dayOfWeek(isoDate('2026-04-28'))).toBe('TUE'); // period end
    expect(dayOfWeek(isoDate('2026-05-06'))).toBe('WED'); // payday
  });
});

describe('localDateOf', () => {
  it('respects the observing timezone across midnight', () => {
    // 23:30 UTC in June is 00:30 BST the *next* day in London.
    expect(localDateOf(new Date('2026-06-13T23:30:00Z'), 'Europe/London')).toBe('2026-06-14');
    // In January London is on GMT — same date.
    expect(localDateOf(new Date('2026-01-10T23:30:00Z'), 'Europe/London')).toBe('2026-01-10');
  });
});
