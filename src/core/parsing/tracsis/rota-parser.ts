import { isoDate, type IsoDate } from '../../dates/iso-date';
import type { CandidateShift, RotaParseInput, RotaParseOutcome, RotaParser } from '../types';

/**
 * Tracsis rota parsers.
 *
 * v1 is built from a real (anonymised) corpus — see tests/fixtures/tracsis —
 * covering the two formats the employer actually sends:
 *
 * 1. "Tracsis Events - Confirmation of Work" (eventjobs@): per-person, one
 *    event per email, shift lines `DD/MM/YYYY HH:MM - HH:MM HH:MMhrs` plus a
 *    stated total. The role is the last " - " segment of the event title
 *    ("… - Reserved Parking"). Each email restates the person's FULL current
 *    shift set for that event, so re-ingestion must be idempotent and a
 *    changed restatement is an amendment (the pipeline diffs; we just parse).
 *
 * 2. "HFS Rota positions (DD/MM/YYYY- DD/MM/YYYY)" (site manager): an HTML
 *    grid of the whole team — one row per person, seven (start,end) column
 *    pairs headed by dates. Cells hold HH:MM times, blanks (off), or marker
 *    words ("RP" = on Reserved Parking that day, times arriving via a
 *    Confirmation of Work; "VIP VAN", "Bravos" = other assignments). Grid
 *    times are Hands-Free shifts. "REVISED" subjects mark change bulletins.
 *
 * Everything a parser cannot prove, it refuses — refusal quarantines with a
 * machine-readable reason and the email becomes a fixture (§11, §12). All
 * internal cross-checks (stated vs computed duration, stated vs summed
 * total) must hold or the email is treated as evidence disagreeing with
 * itself and refused.
 */

const ROLE_SLUGS_BY_NAME: [RegExp, string][] = [
  [/^hands[\s-]*free/i, 'hands-free'],
  [/^reserved\s+parking/i, 'reserved-parking'],
];

const MONTH_YEAR_SUFFIX =
  / (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\s*$/i;

const TIME_RE = /^\d{2}:\d{2}$/;

function refuse(reason: string): RotaParseOutcome {
  return { ok: false, reason };
}

function minutesOf(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

function toIsoDate(ddmmyyyy: string): IsoDate | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy);
  if (!m) return null;
  try {
    return isoDate(`${m[3] ?? ''}-${m[2] ?? ''}-${m[1] ?? ''}`);
  } catch {
    return null;
  }
}

function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ------------------------------ Confirmation ------------------------------ */

function parseConfirmationOfWork(input: RotaParseInput): RotaParseOutcome {
  const body = input.plaintextBody ?? null;
  if (!body) return refuse('CONFIRMATION_HAS_NO_PLAINTEXT');

  const flat = body.replace(/\s+/g, ' ');
  const titleMatch = /details for\s+(.+?)\s+below\s*:/i.exec(flat);
  if (!titleMatch?.[1]) return refuse('EVENT_TITLE_NOT_FOUND');
  const eventTitle = titleMatch[1].trim();

  const segments = eventTitle.split(/\s+-\s+/);
  const roleName = segments.length >= 2 ? (segments[segments.length - 1] ?? '') : '';
  const roleSlug = ROLE_SLUGS_BY_NAME.find(([re]) => re.test(roleName))?.[1] ?? null;
  if (!roleSlug) return refuse(`UNKNOWN_ROLE_IN_EVENT_TITLE: ${roleName || eventTitle}`);

  // "COV - Bicester Village July 2026 - Reserved Parking" → "Bicester Village"
  const venueSegment = segments.length >= 3 ? (segments[1] ?? '') : '';
  const venue = venueSegment ? venueSegment.replace(MONTH_YEAR_SUFFIX, '').trim() || null : null;

  const shiftLine =
    /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s+(\d{2}):(\d{2})\s*hrs\b/;
  const shifts: CandidateShift[] = [];
  const seenDates = new Set<string>();
  for (const rawLine of body.split('\n')) {
    const m = shiftLine.exec(rawLine.trim());
    if (!m) continue;
    const [, dateRaw = '', start = '', end = '', hh = '0', mm = '0'] = m;
    const date = toIsoDate(dateRaw);
    if (!date) return refuse(`INVALID_SHIFT_DATE: ${dateRaw}`);
    if (seenDates.has(date)) return refuse(`DUPLICATE_DATE_IN_CONFIRMATION: ${date}`);
    seenDates.add(date);

    const statedMinutes = Number(hh) * 60 + Number(mm);
    let elapsed = minutesOf(end) - minutesOf(start);
    if (elapsed <= 0) elapsed += 24 * 60;
    if (elapsed !== statedMinutes) {
      return refuse(`DURATION_MISMATCH: ${date} ${start}-${end} stated ${hh}:${mm}hrs`);
    }

    shifts.push({
      externalRef: `cow:${kebab(eventTitle)}:${date}`,
      date,
      startTime: start,
      endTime: end,
      roleSlug,
      venue,
      notes: `Confirmation of Work — ${eventTitle}`,
    });
  }
  if (shifts.length === 0) return refuse('NO_SHIFT_LINES_FOUND');

  const totalMatch = /Total\s+(\d+):(\d{2})\s*hours/i.exec(flat);
  if (!totalMatch) return refuse('TOTAL_LINE_NOT_FOUND');
  const [, totalH = '0', totalM = '00'] = totalMatch;
  const statedTotal = Number(totalH) * 60 + Number(totalM);
  const summed = shifts.reduce((acc, s) => {
    let e = minutesOf(s.endTime) - minutesOf(s.startTime);
    if (e <= 0) e += 24 * 60;
    return acc + e;
  }, 0);
  if (summed !== statedTotal) {
    return refuse(`TOTAL_MISMATCH: stated ${totalH}:${totalM}, shifts sum ${String(summed / 60)}h`);
  }

  return { ok: true, shifts, confidence: 1 };
}

/* --------------------------------- Grid ---------------------------------- */

function cellText(cellHtml: string): string {
  return cellHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tableRows(tableHtml: string): string[][] {
  const rows = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  return rows.map((row) => (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText));
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseHfsGrid(input: RotaParseInput): RotaParseOutcome {
  const html = input.htmlBody ?? null;
  if (!html) return refuse('GRID_HAS_NO_HTML');
  if (input.selfIdentifiers.length === 0) return refuse('ROSTER_NAMES_NOT_CONFIGURED');

  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) ?? [];
  const grids = tables.filter((t) => /EMPLOYEE\s*NAME/i.test(t));
  if (grids.length === 0) return refuse('GRID_TABLE_NOT_FOUND');
  if (grids.length > 1) return refuse('MULTIPLE_GRID_TABLES');
  const rows = tableRows(grids[0] ?? '');

  const dateRow = rows.find((cells) => cells.filter((c) => toIsoDate(c) !== null).length >= 5);
  if (!dateRow) return refuse('GRID_DATE_HEADER_NOT_FOUND');
  // First cell is the row label; the rest are one date per day column.
  const dates = dateRow.slice(1).map((c) => toIsoDate(c));
  if (dates.some((d) => d === null)) return refuse('GRID_DATE_HEADER_MALFORMED');
  const dayCount = dates.length;
  const expectedCells = 1 + dayCount * 2;

  const self = input.selfIdentifiers.map(normalizeName).filter((n) => n.length > 0);
  const matches = rows.filter(
    (cells) =>
      cells.length === expectedCells &&
      cells[0] !== undefined &&
      cells[0] !== '' &&
      self.some((n) => normalizeName(cells[0] ?? '').includes(n))
  );
  if (matches.length === 0) return refuse('ROSTER_ROW_NOT_FOUND');
  if (matches.length > 1) return refuse('AMBIGUOUS_ROSTER_ROW');
  const row = matches[0] ?? [];

  const shifts: CandidateShift[] = [];
  for (let day = 0; day < dayCount; day += 1) {
    const start = row[1 + day * 2] ?? '';
    const end = row[2 + day * 2] ?? '';
    const startIsTime = TIME_RE.test(start);
    const endIsTime = TIME_RE.test(end);
    if (startIsTime !== endIsTime) {
      return refuse(`MALFORMED_CELL_PAIR: ${dates[day] ?? 'unknown-date'} "${start}"/"${end}"`);
    }
    if (!startIsTime) continue; // blank (off) or marker (RP / other assignment)
    const date = dates[day];
    if (!date) continue;
    shifts.push({
      externalRef: `hfs-grid:${date}`,
      date,
      startTime: start,
      endTime: end,
      roleSlug: 'hands-free',
      venue: null,
      notes: 'HFS weekly rota grid',
    });
  }

  // An empty shift list is a valid outcome: present on the rota, no HFS
  // shifts that week (e.g. on Reserved Parking every day).
  return { ok: true, shifts, confidence: 1 };
}

/* -------------------------------- Parsers -------------------------------- */

export const tracsisRotaParserV1: RotaParser = {
  id: 'tracsis-rota',
  version: '1.0.0',
  employerSlug: 'tracsis-events',
  parse(input: RotaParseInput): RotaParseOutcome {
    if (/confirmation of work/i.test(input.subject)) return parseConfirmationOfWork(input);
    if (/rota positions/i.test(input.subject)) return parseHfsGrid(input);
    return refuse('UNRECOGNISED_TRACSIS_FORMAT');
  },
};

/**
 * Version 0 (quarantine everything) is kept runnable so archived emails can
 * be re-parsed by any historical version and compared (§12).
 */
export const tracsisRotaParserV0: RotaParser = {
  id: 'tracsis-rota',
  version: '0.0.0',
  employerSlug: 'tracsis-events',
  parse() {
    return { ok: false, reason: 'AWAITING_SAMPLE_EMAILS' };
  },
};
