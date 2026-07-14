import { addDays, isoDate, type IsoDate } from '@/core/dates/iso-date';
import type { CandidateShift, RotaParseOutcome, RotaParser } from '../types';

const monthIndex: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function parseTime(raw: string): string | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return null;
  }
  return `${pad2(hours)}:${pad2(minutes)}`;
}

function parseDateToken(raw: string, fallbackYear: number): IsoDate | null {
  const compact = raw.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const slash = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(compact);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const yearRaw = slash[3] ? Number(slash[3]) : fallbackYear;
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return isoDate(`${year.toString()}-${pad2(month)}-${pad2(day)}`);
    }
    return null;
  }
  const named = /^(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{2,4}))?$/.exec(compact);
  if (!named) return null;
  const day = Number(named[1]);
  const monthKey = named[2]?.slice(0, 3).toLowerCase();
  if (!monthKey) return null;
  const month = monthIndex[monthKey];
  if (!month) return null;
  const yearRaw = named[3] ? Number(named[3]) : fallbackYear;
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  if (day < 1 || day > 31) return null;
  return isoDate(`${year.toString()}-${pad2(month)}-${pad2(day)}`);
}

function htmlText(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function roleSlugFromText(text: string): 'hands-free' | 'reserved-parking' | null {
  const lc = text.toLowerCase();
  if (/reserved\s*parking|\brp\b/.test(lc)) return 'reserved-parking';
  if (/hands?\s*-?\s*free|\bhfs\b/.test(lc)) return 'hands-free';
  return null;
}

function parseClaimedTotalHours(text: string): number | null {
  const m = /(?:total\s*(?:hours?|duration)|hours?\s*total)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i.exec(text);
  if (!m) return null;
  const hours = Number(m[1]);
  return Number.isFinite(hours) ? hours : null;
}

function hoursBetween(start: string, end: string): number {
  const startParts = /^(\d{2}):(\d{2})$/.exec(start);
  const endParts = /^(\d{2}):(\d{2})$/.exec(end);
  if (!startParts || !endParts) return 0;
  const startMin = Number(startParts[1]) * 60 + Number(startParts[2]);
  let endMin = Number(endParts[1]) * 60 + Number(endParts[2]);
  if (endMin <= startMin) endMin += 24 * 60;
  return (endMin - startMin) / 60;
}

function parseConfirmation(input: {
  text: string;
  subject: string;
  receivedAt: Date;
}): RotaParseOutcome {
  const shifts: CandidateShift[] = [];
  const fallbackYear = input.receivedAt.getUTCFullYear();
  const roleSlug = roleSlugFromText(input.subject) ?? roleSlugFromText(input.text);
  const defaultExternalRef =
    /(?:ref(?:erence)?|job(?:\s*id)?)\s*[:#]?\s*([A-Z0-9-]{4,})/i.exec(input.text)?.[1] ?? null;

  const linePattern =
    /(?<date>\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?)[^\n]*?(?<start>\d{1,2}[:.]\d{2})\s*[-–]\s*(?<end>\d{1,2}[:.]\d{2})(?:[^\n]*?(?<hours>\d+(?:\.\d+)?)\s*(?:h|hours?)\b)?/gi;
  for (const match of input.text.matchAll(linePattern)) {
    const date = parseDateToken(match.groups?.date ?? '', fallbackYear);
    const startTime = parseTime(match.groups?.start ?? '');
    const endTime = parseTime(match.groups?.end ?? '');
    if (!date || !startTime || !endTime) continue;
    const claimed = match.groups?.hours ? Number(match.groups.hours) : null;
    if (claimed !== null && Math.abs(claimed - hoursBetween(startTime, endTime)) > 0.02) {
      return { ok: false, reason: 'CONTRADICTORY_ARITHMETIC' };
    }
    const line = match[0];
    const externalRef =
      /(?:ref(?:erence)?|job(?:\s*id)?)\s*[:#]?\s*([A-Z0-9-]{4,})/i.exec(line)?.[1] ??
      defaultExternalRef;
    shifts.push({
      externalRef: externalRef ?? null,
      date,
      startTime,
      endTime,
      roleSlug,
      venue: null,
      notes: null,
    });
  }

  if (shifts.length === 0) return { ok: false, reason: 'NO_SHIFT_LINES' };

  const claimedTotal = parseClaimedTotalHours(input.text);
  if (claimedTotal !== null) {
    const computed = shifts.reduce((sum, shift) => sum + hoursBetween(shift.startTime, shift.endTime), 0);
    if (Math.abs(claimedTotal - computed) > 0.02) {
      return { ok: false, reason: 'CONTRADICTORY_ARITHMETIC' };
    }
  }

  return { ok: true, confidence: 0.97, shifts };
}

function cellText(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, ' / ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWeeklyStart(subject: string, receivedAt: Date): IsoDate | null {
  const m = /(?:w\/c|week(?:\s+commencing)?)\s*(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)/i.exec(subject);
  const value = m?.[1];
  if (!value) return null;
  return parseDateToken(value, receivedAt.getUTCFullYear());
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseHfsGrid(input: {
  html: string;
  subject: string;
  receivedAt: Date;
  rosterNames: string[];
}): RotaParseOutcome {
  const rows = [...input.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...(row[1] ?? '').matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => cellText(cell[1] ?? ''))
  );
  if (rows.length === 0) return { ok: false, reason: 'GRID_NOT_FOUND' };

  const targetNames = input.rosterNames.map(normalizeName).filter(Boolean);
  const bodyRows = rows.filter((cells) => cells.length >= 8);
  const personRow = bodyRows.find((cells) => {
    const key = normalizeName(cells[0] ?? '');
    return targetNames.some((target) => key.includes(target) || target.includes(key));
  });
  if (!personRow) return { ok: false, reason: 'ROSTER_NAME_NOT_FOUND' };

  const weekStart = parseWeeklyStart(input.subject, input.receivedAt);
  if (!weekStart) return { ok: false, reason: 'WEEK_START_UNKNOWN' };

  const shifts: CandidateShift[] = [];
  for (let day = 0; day < 7; day += 1) {
    const raw = (personRow[day + 1] ?? '').trim();
    if (!raw) continue;
    if (/^\s*rp\s*$/i.test(raw)) continue;
    const time = /(\d{1,2}[:.]\d{2})\s*[-–]\s*(\d{1,2}[:.]\d{2})/.exec(raw);
    if (!time) continue;
    const startRaw = time[1];
    const endRaw = time[2];
    if (!startRaw || !endRaw) continue;
    const startTime = parseTime(startRaw);
    const endTime = parseTime(endRaw);
    if (!startTime || !endTime) continue;
    shifts.push({
      externalRef: null,
      date: addDays(weekStart, day),
      startTime,
      endTime,
      roleSlug: 'hands-free',
      venue: null,
      notes: null,
    });
  }
  if (shifts.length === 0) return { ok: false, reason: 'NO_HFS_SHIFTS_FOUND' };
  return { ok: true, confidence: 0.9, shifts };
}

export const tracsisRotaParserV1: RotaParser = {
  id: 'tracsis-rota',
  version: '1.0.0',
  employerSlug: 'tracsis-events',
  parse(input) {
    const rosterNames = input.hints?.rosterNames ?? [];
    const from = input.fromAddress.toLowerCase();
    const subject = input.subject.toLowerCase();
    const plain = input.plaintextBody?.trim() ?? '';
    const text = plain || (input.htmlBody ? htmlText(input.htmlBody) : '');

    if (from.includes('eventjobs@tracsis.com') || subject.includes('confirmation of work')) {
      return parseConfirmation({ text, subject: input.subject, receivedAt: input.receivedAt });
    }

    if (input.htmlBody && (subject.includes('hfs') || subject.includes('rota') || rosterNames.length > 0)) {
      return parseHfsGrid({
        html: input.htmlBody,
        subject: input.subject,
        receivedAt: input.receivedAt,
        rosterNames,
      });
    }

    return { ok: false, reason: 'UNRECOGNISED_TRACSIS_ROTA_FORMAT' };
  },
};
