import { z } from 'zod';
import { DomainError } from '../errors';

/**
 * Calendar date in ISO `YYYY-MM-DD` form, branded so arbitrary strings cannot
 * flow in. Pay periods, rota dates, and effective dates are *calendar dates in
 * the employer's timezone*, not instants — modelling them this way makes all
 * period math timezone-free. Timezones matter only at two boundaries:
 * converting an instant to a local date (`localDateOf`) and computing shift
 * durations (plain instant arithmetic).
 */
declare const isoDateBrand: unique symbol;
export type IsoDate = string & { readonly [isoDateBrand]: true };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isoDate(value: string): IsoDate {
  if (!isIsoDate(value))
    throw new DomainError(`not a valid ISO date: ${value}`, 'INVALID_ARGUMENT');
  return value;
}

export const isoDateSchema = z.custom<IsoDate>(
  (v) => typeof v === 'string' && isIsoDate(v),
  'expected an ISO calendar date (YYYY-MM-DD)'
);

/** UTC midnight instant of the calendar date — internal anchor for arithmetic. */
export function toUtcMidnight(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromUtcInstant(instant: Date): IsoDate {
  return instant.toISOString().slice(0, 10) as IsoDate;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new DomainError('days must be an integer', 'INVALID_ARGUMENT');
  return fromUtcInstant(new Date(toUtcMidnight(date).getTime() + days * MS_PER_DAY));
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMidnight(b).getTime() - toUtcMidnight(a).getTime()) / MS_PER_DAY);
}

/** Lexicographic comparison is chronological for ISO dates. */
export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
const DAYS: readonly DayOfWeek[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function dayOfWeek(date: IsoDate): DayOfWeek {
  const day = DAYS[toUtcMidnight(date).getUTCDay()];
  if (!day) throw new DomainError(`cannot derive day of week for ${date}`, 'INVALID_ARGUMENT');
  return day;
}

/** The calendar date of an instant as observed in an IANA timezone. */
export function localDateOf(instant: Date, timeZone: string): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return isoDate(formatted);
}
