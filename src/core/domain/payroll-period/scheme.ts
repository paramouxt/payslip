import { z } from 'zod';
import { DomainError } from '../../errors';
import {
  addDays,
  compareIsoDates,
  diffDays,
  isoDateSchema,
  type IsoDate,
} from '../../dates/iso-date';

/**
 * Pay-period schemes are employer configuration documents, not code.
 *
 * `FIXED_LENGTH_ANCHORED` covers weekly/fortnightly/four-weekly payrolls: pick
 * one known period (the anchor), give the length and the payday offset, and
 * every other period follows arithmetically — forwards and backwards.
 * Irregular one-offs (like the Tracsis April 2026 weekly→fortnightly
 * transition) are explicit `overrides`, which win over the formula.
 *
 * Evidence for the Tracsis instance (employer communication, 18 Mar 2026):
 * hours worked 15–28 Apr 2026 are paid 6 May 2026 → anchorStart 2026-04-15,
 * lengthDays 14, payDateOffsetDays 8.
 */
export const periodOverrideSchema = z.object({
  sequence: z.number().int(),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  payDate: isoDateSchema,
});

export const payPeriodSchemeSchema = z.object({
  version: z.literal(1),
  kind: z.literal('FIXED_LENGTH_ANCHORED'),
  anchorStart: isoDateSchema,
  anchorSequence: z.number().int(),
  lengthDays: z.number().int().min(1).max(35),
  payDateOffsetDays: z.number().int().min(0).max(60),
  overrides: z.array(periodOverrideSchema).default([]),
});

export type PayPeriodScheme = z.infer<typeof payPeriodSchemeSchema>;
export type PeriodOverride = z.infer<typeof periodOverrideSchema>;

export interface PeriodSpan {
  sequence: number;
  startDate: IsoDate;
  endDate: IsoDate;
  payDate: IsoDate;
}

export function parsePayPeriodScheme(raw: unknown): PayPeriodScheme {
  const result = payPeriodSchemeSchema.safeParse(raw);
  if (!result.success) {
    throw new DomainError(`invalid pay period scheme: ${result.error.message}`, 'CONFIG_INVALID');
  }
  return result.data;
}

/** The period a worked calendar date belongs to. Overrides win over formula. */
export function resolvePeriodFor(scheme: PayPeriodScheme, date: IsoDate): PeriodSpan {
  for (const o of scheme.overrides) {
    if (compareIsoDates(date, o.startDate) >= 0 && compareIsoDates(date, o.endDate) <= 0) {
      return {
        sequence: o.sequence,
        startDate: o.startDate,
        endDate: o.endDate,
        payDate: o.payDate,
      };
    }
  }
  const offset = diffDays(scheme.anchorStart, date);
  const index = Math.floor(offset / scheme.lengthDays);
  const startDate = addDays(scheme.anchorStart, index * scheme.lengthDays);
  const endDate = addDays(startDate, scheme.lengthDays - 1);
  // A formula-computed span must not touch any override's range: overrides
  // exist precisely because the formula is wrong there (e.g. a pay-frequency
  // transition). A date outside every override whose computed span overlaps
  // one is simply not covered by this scheme — refusing loudly beats silently
  // colliding period sequences.
  for (const o of scheme.overrides) {
    if (compareIsoDates(startDate, o.endDate) <= 0 && compareIsoDates(endDate, o.startDate) >= 0) {
      throw new DomainError(
        `date ${date} is not covered by the pay period scheme (computed period ` +
          `${startDate}..${endDate} collides with override ${o.startDate}..${o.endDate}); ` +
          'add an override for this range',
        'CONFIG_INVALID'
      );
    }
  }
  return {
    sequence: scheme.anchorSequence + index,
    startDate,
    endDate,
    payDate: addDays(endDate, scheme.payDateOffsetDays),
  };
}

/** Every period touching the inclusive date range, in sequence order. */
export function periodsBetween(scheme: PayPeriodScheme, from: IsoDate, to: IsoDate): PeriodSpan[] {
  if (compareIsoDates(from, to) > 0) {
    throw new DomainError('from must not be after to', 'INVALID_ARGUMENT');
  }
  const spans: PeriodSpan[] = [];
  let cursor = from;
  for (;;) {
    const span = resolvePeriodFor(scheme, cursor);
    if (spans.length === 0 || spans[spans.length - 1]?.sequence !== span.sequence) {
      spans.push(span);
    }
    if (compareIsoDates(span.endDate, to) >= 0) break;
    cursor = addDays(span.endDate, 1);
  }
  return spans;
}
