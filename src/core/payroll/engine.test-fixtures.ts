import { isoDate } from '../dates/iso-date';
import type { RateVersionSpec } from '../domain/employer/employer-config';
import type { EngineEmployerConfig } from './engine';

/**
 * Tracsis-SHAPED engine config for unit tests. Deliberately constructed here
 * rather than importing the server template: core tests must not depend on
 * the server layer (§4.1), and the real template has its own tests.
 */
export function buildTestEmployerConfig(overrides?: {
  handsFreeVersions?: RateVersionSpec[];
}): EngineEmployerConfig {
  return {
    currency: 'GBP',
    roundingPolicy: {
      version: 1,
      level: 'PER_SHIFT_COMPONENT',
      mode: 'HALF_UP',
      holidayComputation: 'PER_HOUR_RATE',
    },
    rateClasses: [
      {
        slug: 'hands-free',
        name: 'Hands-Free',
        versions: overrides?.handsFreeVersions ?? [
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
  };
}
