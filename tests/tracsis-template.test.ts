import { describe, expect, it } from 'vitest';
import { isoDate } from '@/core/dates/iso-date';
import { Money } from '@/core/money/money';
import { resolvePeriodFor } from '@/core/domain/payroll-period/scheme';
import { resolveRateClass } from '@/core/domain/rules/rule-engine';
import { buildTracsisEmployerTemplate } from '@/server/templates/tracsis';

/**
 * The template must reproduce the two pieces of hard evidence we hold:
 * the employer's pay-period worked example and the brief's derived holiday
 * amounts. If the template drifts from the evidence, this fails.
 */
describe('Tracsis employer template', () => {
  const config = buildTracsisEmployerTemplate();

  it('validates as a complete employer config', () => {
    expect(config.slug).toBe('tracsis-events');
    expect(config.currency).toBe('GBP');
    expect(config.roles.map((r) => r.slug).sort()).toEqual(['hands-free', 'reserved-parking']);
  });

  it('reproduces the pay-period worked example (15–28 Apr → 6 May)', () => {
    expect(resolvePeriodFor(config.payPeriodScheme, isoDate('2026-04-20'))).toEqual({
      sequence: 1,
      startDate: '2026-04-15',
      endDate: '2026-04-28',
      payDate: '2026-05-06',
    });
    expect(resolvePeriodFor(config.payPeriodScheme, isoDate('2026-04-08')).payDate).toBe(
      '2026-04-22'
    );
  });

  it("derives the brief's holiday-pay figures from the 12.07% component", () => {
    for (const [slug, expectedBase, expectedHoliday] of [
      ['hands-free', 1388, 168],
      ['reserved-parking', 1506, 182],
    ] as const) {
      const rateClass = config.rateClasses.find((rc) => rc.slug === slug)!;
      const version = rateClass.versions[0]!;
      const base = version.components.find((c) => c.type === 'BASE')!;
      const holiday = version.components.find((c) => c.type === 'HOLIDAY_ROLLED_UP')!;
      expect(base.pencePerHour).toBe(expectedBase);
      expect(
        Money.of(expectedBase, 'GBP').percent(holiday.percentOfBase, config.roundingPolicy.mode)
          .pence
      ).toBe(expectedHoliday);
    }
  });

  it('encodes both uplift rules with Sunday outranking duration', () => {
    const sunday = resolveRateClass({
      facts: {
        roleSlug: 'hands-free',
        dayOfWeek: 'SUN',
        scheduledHours: 8,
        venue: null,
        date: isoDate('2026-06-14'),
      },
      overrideRateClassSlug: null,
      roleDefaultRateClassSlug: 'hands-free',
      rules: config.rules,
    });
    expect(sunday?.rateClassSlug).toBe('reserved-parking');
    expect(sunday?.decidedBy).toBe('RULE');

    const tenHour = resolveRateClass({
      facts: {
        roleSlug: 'hands-free',
        dayOfWeek: 'THU',
        scheduledHours: 10,
        venue: null,
        date: isoDate('2026-06-18'),
      },
      overrideRateClassSlug: null,
      roleDefaultRateClassSlug: 'hands-free',
      rules: config.rules,
    });
    expect(tenHour?.rateClassSlug).toBe('reserved-parking');
  });
});
