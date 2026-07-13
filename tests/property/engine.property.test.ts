import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isoDate, addDays } from '@/core/dates/iso-date';
import { roundToInt, type RoundingMode } from '@/core/money/money';
import { computePeriodGross, type ShiftPricingInput } from '@/core/payroll/engine';
import { buildTestEmployerConfig } from '@/core/payroll/engine.test-fixtures';

/**
 * Property tests (constitution §15): engine invariants that must hold for ALL
 * inputs, not just the fixtures we thought of.
 */
const config = buildTestEmployerConfig();

const shiftArb: fc.Arbitrary<ShiftPricingInput> = fc.record({
  shiftId: fc.uuid(),
  date: fc.integer({ min: 0, max: 360 }).map((d) => addDays(isoDate('2026-04-01'), d)),
  scheduledHours: fc.integer({ min: 1, max: 24 }),
  roleSlug: fc.constantFrom('hands-free', 'reserved-parking'),
  roleDefaultRateClassSlug: fc.constantFrom('hands-free', 'reserved-parking'),
  overrideRateClassSlug: fc.constantFrom(null, 'hands-free', 'reserved-parking'),
  venue: fc.constant('Bicester Village'),
});

describe('engine invariants', () => {
  it('period gross is invariant under shift reordering', () => {
    fc.assert(
      fc.property(fc.array(shiftArb, { minLength: 1, maxLength: 12 }), (shifts) => {
        const forward = computePeriodGross(shifts, config).grossPence;
        const reversed = computePeriodGross([...shifts].reverse(), config).grossPence;
        expect(reversed).toBe(forward);
      })
    );
  });

  it('splitting a shift preserves total pay ONLY when the rate class is pinned', () => {
    // Found by this very property: the naive claim ("splitting never changes
    // pay") is FALSE for Tracsis — a 10h Hands-Free shift out-earns 1h+9h
    // because the 10-hour rule stops firing. Duration-dependent rules make
    // pay non-linear by design. With the class pinned via override, pricing
    // is linear in whole hours (PER_HOUR_RATE holiday), so the invariant holds.
    fc.assert(
      fc.property(
        shiftArb.filter((s) => s.scheduledHours >= 2),
        fc.integer({ min: 1, max: 23 }),
        fc.constantFrom('hands-free', 'reserved-parking'),
        (shift, splitRaw, pinned) => {
          const split = Math.min(shift.scheduledHours - 1, splitRaw);
          const pinnedShift = { ...shift, overrideRateClassSlug: pinned };
          const whole = computePeriodGross([pinnedShift], config).grossPence;
          const parts = computePeriodGross(
            [
              { ...pinnedShift, shiftId: 'a', scheduledHours: split },
              { ...pinnedShift, shiftId: 'b', scheduledHours: shift.scheduledHours - split },
            ],
            config
          ).grossPence;
          expect(parts).toBe(whole);
        }
      )
    );
  });

  it('the 10-hour rule makes whole > sum-of-parts for Hands-Free (regression of the discovery)', () => {
    const base = {
      shiftId: 'w',
      date: isoDate('2026-04-01'), // Wednesday
      scheduledHours: 10,
      roleSlug: 'hands-free',
      roleDefaultRateClassSlug: 'hands-free',
      overrideRateClassSlug: null,
      venue: null,
    };
    const whole = computePeriodGross([base], config).grossPence;
    const parts = computePeriodGross(
      [
        { ...base, shiftId: 'a', scheduledHours: 1 },
        { ...base, shiftId: 'b', scheduledHours: 9 },
      ],
      config
    ).grossPence;
    expect(whole).toBeGreaterThan(parts); // RP rates for 10h beat HF rates for 1h+9h
  });

  it('every rounding mode stays within one penny of the true value', () => {
    const modes: RoundingMode[] = ['HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL', 'TRUNCATE'];
    fc.assert(
      fc.property(
        fc.double({ min: -1e9, max: 1e9, noNaN: true }),
        fc.constantFrom(...modes),
        (value, mode) => {
          const rounded = roundToInt(value, mode);
          expect(Number.isSafeInteger(rounded)).toBe(true);
          expect(Math.abs(rounded - value)).toBeLessThanOrEqual(1);
        }
      )
    );
  });
});
