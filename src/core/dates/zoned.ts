import { DomainError } from '../errors';
import { toUtcMidnight, type IsoDate } from './iso-date';

/**
 * Wall-clock → instant conversion for an IANA timezone, dependency-free.
 * Uses the standard two-pass Intl offset probe, which is exact for real
 * timezones including DST transitions (a 09:00 London start is 08:00Z in
 * summer, 09:00Z in winter).
 */

function tzOffsetMs(timeZone: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    (parts.hour ?? 0) % 24,
    parts.minute ?? 0,
    parts.second ?? 0
  );
  return asUtc - instant.getTime();
}

/** The instant at which `date` reads `HH:mm` on a wall clock in `timeZone`. */
export function instantFromZoned(date: IsoDate, time: string, timeZone: string): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new DomainError(`invalid time: ${time}`, 'INVALID_ARGUMENT');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new DomainError(`invalid time: ${time}`, 'INVALID_ARGUMENT');
  }
  const wallAsUtc = toUtcMidnight(date).getTime() + (hours * 60 + minutes) * 60_000;
  let instant = new Date(wallAsUtc - tzOffsetMs(timeZone, new Date(wallAsUtc)));
  instant = new Date(wallAsUtc - tzOffsetMs(timeZone, instant));
  return instant;
}

/** Wall-clock HH:mm of an instant in a timezone (for display/round-trips). */
export function zonedTimeOf(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}
