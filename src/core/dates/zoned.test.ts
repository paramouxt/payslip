import { describe, expect, it } from 'vitest';
import { isoDate } from './iso-date';
import { instantFromZoned, zonedTimeOf } from './zoned';

describe('instantFromZoned', () => {
  it('maps London wall time to the right instant across DST', () => {
    // June: BST (UTC+1) → 09:00 wall = 08:00Z
    expect(instantFromZoned(isoDate('2026-06-14'), '09:00', 'Europe/London').toISOString()).toBe(
      '2026-06-14T08:00:00.000Z'
    );
    // January: GMT → 09:00 wall = 09:00Z
    expect(instantFromZoned(isoDate('2026-01-14'), '09:00', 'Europe/London').toISOString()).toBe(
      '2026-01-14T09:00:00.000Z'
    );
  });

  it('handles the spring-forward day (clocks jump 29 Mar 2026)', () => {
    // 05:00 wall on transition day is already BST.
    expect(instantFromZoned(isoDate('2026-03-29'), '05:00', 'Europe/London').toISOString()).toBe(
      '2026-03-29T04:00:00.000Z'
    );
  });

  it('round-trips through zonedTimeOf', () => {
    const instant = instantFromZoned(isoDate('2026-10-25'), '07:30', 'Europe/London');
    expect(zonedTimeOf(instant, 'Europe/London')).toBe('07:30');
  });

  it('rejects malformed times', () => {
    expect(() => instantFromZoned(isoDate('2026-06-14'), '9:00', 'Europe/London')).toThrow();
    expect(() => instantFromZoned(isoDate('2026-06-14'), '24:00', 'Europe/London')).toThrow();
  });
});
