import { isoDate } from '@/core/dates/iso-date';
import { parseEmployerConfig, type EmployerConfig } from '@/core/domain/employer/employer-config';

/**
 * Tracsis Events employer template — configuration data, zero engine code.
 *
 * Provenance:
 *  - Pay periods & holiday %: employer communication "Bicester Village Pay
 *    Frequency and Holiday Pay Communications", 18 Mar 2026 (fortnightly from
 *    April 2026; paid every other Wednesday for hours worked up to the
 *    previous Tuesday; worked example 15–28 Apr → paid 6 May; rolled-up
 *    holiday pay at 12.07% of the hourly rate from 1 Apr).
 *  - Rates & assignment rules: product owner brief (Hands-Free £13.88/h,
 *    Reserved Parking £15.06/h; Sunday and 10-hour Hands-Free shifts paid at
 *    Reserved Parking; manual overrides possible).
 *
 * Note the brief's "Holiday Pay £1.68/£1.82" figures are the 12.07% *derived*
 * amounts — holiday is a percentage component here, so a base-rate change
 * flows through automatically.
 *
 * Open question (Phase 1 §9 Q3): "10-hour shift" is modelled as scheduled
 * duration ≥ 10h pending confirmation.
 */
export function buildTracsisEmployerTemplate(): EmployerConfig {
  return parseEmployerConfig({
    name: 'Tracsis Events',
    slug: 'tracsis-events',
    timezone: 'Europe/London',
    currency: 'GBP',
    jurisdiction: 'GB',
    payPeriodScheme: {
      version: 1,
      kind: 'FIXED_LENGTH_ANCHORED',
      anchorStart: isoDate('2026-04-15'),
      anchorSequence: 1,
      lengthDays: 14,
      payDateOffsetDays: 8,
      overrides: [
        // Weekly→fortnightly transition: hours 6–14 Apr 2026 paid 22 Apr.
        {
          sequence: 0,
          startDate: isoDate('2026-04-06'),
          endDate: isoDate('2026-04-14'),
          payDate: isoDate('2026-04-22'),
        },
      ],
    },
    roundingPolicy: {
      version: 1,
      level: 'PER_SHIFT_COMPONENT',
      mode: 'HALF_UP',
    },
    senderPatterns: [{ fromDomain: 'tracsis.com' }],
    roles: [
      { slug: 'hands-free', name: 'Hands-Free', defaultRateClassSlug: 'hands-free' },
      {
        slug: 'reserved-parking',
        name: 'Reserved Parking',
        defaultRateClassSlug: 'reserved-parking',
      },
    ],
    rateClasses: [
      {
        slug: 'hands-free',
        name: 'Hands-Free',
        versions: [
          {
            effectiveFrom: isoDate('2026-04-01'),
            effectiveTo: null,
            components: [
              { type: 'BASE', pencePerHour: 1388 },
              { type: 'HOLIDAY_ROLLED_UP', percentOfBase: 12.07 },
            ],
          },
        ],
      },
      {
        slug: 'reserved-parking',
        name: 'Reserved Parking',
        versions: [
          {
            effectiveFrom: isoDate('2026-04-01'),
            effectiveTo: null,
            components: [
              { type: 'BASE', pencePerHour: 1506 },
              { type: 'HOLIDAY_ROLLED_UP', percentOfBase: 12.07 },
            ],
          },
        ],
      },
    ],
    rules: [
      {
        priority: 10,
        name: 'Sunday Hands-Free shifts paid at Reserved Parking rate',
        when: {
          all: [
            { fact: 'roleSlug', op: 'eq', value: 'hands-free' },
            { fact: 'dayOfWeek', op: 'eq', value: 'SUN' },
          ],
        },
        then: { assignRateClass: 'reserved-parking' },
      },
      {
        priority: 20,
        name: '10-hour Hands-Free shifts paid at Reserved Parking rate',
        when: {
          all: [
            { fact: 'roleSlug', op: 'eq', value: 'hands-free' },
            { fact: 'scheduledHours', op: 'gte', value: 10 },
          ],
        },
        then: { assignRateClass: 'reserved-parking' },
      },
    ],
    rulesEffectiveFrom: isoDate('2026-04-01'),
  });
}
