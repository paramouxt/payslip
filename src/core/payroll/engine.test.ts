import { describe, expect, it } from 'vitest';
import { isoDate } from '../dates/iso-date';
import { DomainError } from '../errors';
import { buildTestEmployerConfig } from './engine.test-fixtures';
import { computePeriodGross, computeShiftPay, type ShiftPricingInput } from './engine';

const config = buildTestEmployerConfig();

function shift(overrides: Partial<ShiftPricingInput>): ShiftPricingInput {
  return {
    shiftId: 's1',
    date: isoDate('2026-06-18'), // Thursday
    scheduledHours: 8,
    roleSlug: 'hands-free',
    roleDefaultRateClassSlug: 'hands-free',
    overrideRateClassSlug: null,
    venue: 'Bicester Village',
    ...overrides,
  };
}

describe('computeShiftPay — Tracsis-shaped config', () => {
  it('prices a weekday Hands-Free shift: base + 12.07% holiday per evidenced presentation', () => {
    const priced = computeShiftPay(shift({}), config);
    // 8h × £13.88 = £111.04; holiday £1.68/h (12.07% of £13.88, HALF_UP) × 8 = £13.44
    expect(priced.decision.decidedBy).toBe('ROLE_DEFAULT');
    expect(priced.components).toEqual([
      { type: 'BASE', pence: 11104 },
      { type: 'HOLIDAY_ROLLED_UP', pence: 1344 },
    ]);
    expect(priced.grossPence).toBe(12448);
    expect(priced.explanation.children).toHaveLength(2);
  });

  it('applies the Sunday rule: Reserved Parking rates with the rule cited', () => {
    const priced = computeShiftPay(shift({ date: isoDate('2026-06-14') }), config); // Sunday
    // 8h × £15.06 = £120.48; holiday £1.82/h × 8 = £14.56
    expect(priced.decision.decidedBy).toBe('RULE');
    expect(priced.grossPence).toBe(12048 + 1456);
    expect(priced.explanation.detail).toContain('Sunday');
  });

  it('applies the 10-hour rule', () => {
    const priced = computeShiftPay(shift({ scheduledHours: 10 }), config);
    // 10h × £15.06 = £150.60; holiday £1.82 × 10 = £18.20
    expect(priced.grossPence).toBe(15060 + 1820);
  });

  it('manual override beats the rules and says so', () => {
    const priced = computeShiftPay(
      shift({ date: isoDate('2026-06-14'), overrideRateClassSlug: 'hands-free' }),
      config
    );
    expect(priced.decision.decidedBy).toBe('OVERRIDE');
    expect(priced.explanation.detail).toContain('manual override');
  });

  it('handles fractional hours with explicit rounding', () => {
    const priced = computeShiftPay(shift({ scheduledHours: 7.5 }), config);
    // base 7.5 × 1388 = 10410; holiday 168 × 7.5 = 1260
    expect(priced.grossPence).toBe(10410 + 1260);
  });

  it('uses the rate version in force on the shift date', () => {
    const withRaise = buildTestEmployerConfig({
      handsFreeVersions: [
        {
          effectiveFrom: isoDate('2026-04-01'),
          effectiveTo: isoDate('2026-06-30'),
          components: [
            { type: 'BASE', pencePerHour: 1388 },
            { type: 'HOLIDAY_ROLLED_UP', percentOfBase: 12.07 },
          ],
        },
        {
          effectiveFrom: isoDate('2026-07-01'),
          effectiveTo: null,
          components: [
            { type: 'BASE', pencePerHour: 1500 },
            { type: 'HOLIDAY_ROLLED_UP', percentOfBase: 12.07 },
          ],
        },
      ],
    });
    const before = computeShiftPay(shift({ date: isoDate('2026-06-25') }), withRaise);
    const after = computeShiftPay(shift({ date: isoDate('2026-07-02') }), withRaise);
    expect(before.components[0]!.pence).toBe(11104); // 8 × 13.88
    expect(after.components[0]!.pence).toBe(12000); // 8 × 15.00
    expect(after.rateVersionEffectiveFrom).toBe('2026-07-01');
  });

  it('refuses shifts with no decidable rate class or dated version', () => {
    expect(() =>
      computeShiftPay(shift({ roleSlug: null, roleDefaultRateClassSlug: null }), config)
    ).toThrow(DomainError);
    expect(() => computeShiftPay(shift({ date: isoDate('2026-03-01') }), config)).toThrow(
      /no rate version/
    );
  });
});

describe('computePeriodGross', () => {
  it('sums shifts and builds the full tree', () => {
    const period = computePeriodGross(
      [shift({ shiftId: 'a' }), shift({ shiftId: 'b', date: isoDate('2026-06-14') })],
      config
    );
    expect(period.grossPence).toBe(12448 + 13504);
    expect(period.explanation.children).toHaveLength(2);
    expect(period.explanation.amountPence).toBe(period.grossPence);
  });
});
