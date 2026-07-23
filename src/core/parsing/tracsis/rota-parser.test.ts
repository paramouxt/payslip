import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RotaParseInput } from '../types';
import { tracsisRotaParserV0, tracsisRotaParserV1 } from './rota-parser';

/**
 * Fixture-driven tests (constitution §15): the corpus is anonymised copies
 * of real Tracsis emails — structure, wording, and shift data preserved,
 * PII replaced. Every future parse failure grows this corpus.
 */
const fixture = (name: string): string =>
  readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'tracsis', name), 'utf8');

const base: Omit<RotaParseInput, 'subject' | 'plaintextBody' | 'htmlBody'> = {
  fromAddress: 'eventjobs@tracsis.com',
  receivedAt: new Date('2026-07-09T14:07:00Z'),
  attachments: [],
  selfIdentifiers: ['Alex Rowan'],
};

const confirmation = (body: string): RotaParseInput => ({
  ...base,
  subject: 'Tracsis Events - Confirmation of Work',
  plaintextBody: body,
  htmlBody: null,
});

const grid = (html: string, selfIdentifiers = ['Alex Rowan']): RotaParseInput => ({
  ...base,
  fromAddress: 'site.manager@tracsis.com',
  subject: 'HFS Rota positions (29/06/2026- 05/07/2026) REVISED',
  plaintextBody: null,
  htmlBody: html,
  selfIdentifiers,
});

describe('tracsis confirmation-of-work parser (v1)', () => {
  it('parses a Reserved Parking confirmation: all shifts, role, venue, stable refs', () => {
    const outcome = tracsisRotaParserV1.parse(
      confirmation(fixture('confirmation-reserved-parking.txt'))
    );
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
    expect(outcome.shifts).toHaveLength(9);
    expect(outcome.confidence).toBe(1);
    expect(outcome.sourceKind).toBe('EVENT_CONFIRMATION');
    expect(outcome.authoritativeDates).toEqual([]);
    for (const shift of outcome.shifts) {
      expect(shift.roleSlug).toBe('reserved-parking');
      expect(shift.venue).toBe('Bicester Village');
      expect(shift.externalRef).toMatch(/^cow:cov-bicester-village-july-2026-reserved-parking:/);
    }
    expect(outcome.shifts[0]).toMatchObject({
      date: '2026-07-01',
      startTime: '12:00',
      endTime: '21:00',
    });
    expect(outcome.shifts[3]).toMatchObject({
      date: '2026-07-07',
      startTime: '08:00',
      endTime: '17:00',
    });
  });

  it('parses a Hands-Free confirmation including the 10-hour shift', () => {
    const outcome = tracsisRotaParserV1.parse(confirmation(fixture('confirmation-hands-free.txt')));
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
    expect(outcome.shifts).toHaveLength(4);
    expect(outcome.shifts.every((s) => s.roleSlug === 'hands-free')).toBe(true);
    expect(outcome.shifts[2]).toMatchObject({
      date: '2026-07-11',
      startTime: '11:00',
      endTime: '21:00',
    });
  });

  it('refuses when a stated per-shift duration disagrees with the times', () => {
    const tampered = fixture('confirmation-hands-free.txt').replace(
      '05/07/2026 10:00 - 19:00 09:00hrs',
      '05/07/2026 10:00 - 19:00 08:00hrs'
    );
    const outcome = tracsisRotaParserV1.parse(confirmation(tampered));
    expect(outcome).toMatchObject({ ok: false });
    if (!outcome.ok) expect(outcome.reason).toContain('DURATION_MISMATCH');
  });

  it('refuses when the stated total disagrees with the sum of shifts', () => {
    const tampered = fixture('confirmation-hands-free.txt').replace(
      'Total 35:00 hours',
      'Total 36:00 hours'
    );
    const outcome = tracsisRotaParserV1.parse(confirmation(tampered));
    expect(outcome).toMatchObject({ ok: false });
    if (!outcome.ok) expect(outcome.reason).toContain('TOTAL_MISMATCH');
  });

  it('refuses an event title whose role it does not recognise', () => {
    const tampered = fixture('confirmation-hands-free.txt').replaceAll(
      'Hands-Free Shopping',
      'Traffic Management'
    );
    const outcome = tracsisRotaParserV1.parse(confirmation(tampered));
    expect(outcome).toMatchObject({ ok: false });
    if (!outcome.ok) expect(outcome.reason).toContain('UNKNOWN_ROLE');
  });

  it('refuses unrecognised subjects outright', () => {
    const outcome = tracsisRotaParserV1.parse({
      ...base,
      subject: 'Christmas party!',
      plaintextBody: 'Save the date',
      htmlBody: null,
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'UNRECOGNISED_TRACSIS_FORMAT' });
  });
});

describe('tracsis HFS grid parser (v1)', () => {
  it('extracts only the self row: times become hands-free shifts; RP/markers/blanks do not', () => {
    const outcome = tracsisRotaParserV1.parse(grid(fixture('hfs-grid-revised.html')));
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
    expect(outcome.shifts).toHaveLength(1);
    expect(outcome.sourceKind).toBe('WEEKLY_GRID');
    expect(outcome.authoritativeDates).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ]);
    expect(outcome.shifts[0]).toMatchObject({
      date: '2026-07-05',
      startTime: '10:00',
      endTime: '19:00',
      roleSlug: 'hands-free',
      externalRef: 'hfs-grid:2026-07-05',
    });
  });

  it('a matched row with no times is a valid empty week, not a failure', () => {
    const outcome = tracsisRotaParserV1.parse(
      grid(fixture('hfs-grid-revised.html'), ['Morgan Reid'])
    );
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
    expect(outcome.shifts).toHaveLength(0);
  });

  it('accepts Bruno-style singular rota position subjects', () => {
    const outcome = tracsisRotaParserV1.parse({
      ...grid(fixture('hfs-grid-revised.html')),
      subject: 'HFS Rota Position - week commencing 29/06/2026',
    });
    expect(outcome).toMatchObject({ ok: true, sourceKind: 'WEEKLY_GRID' });
  });

  it('refuses when roster names are not configured', () => {
    const outcome = tracsisRotaParserV1.parse(grid(fixture('hfs-grid-revised.html'), []));
    expect(outcome).toMatchObject({ ok: false, reason: 'ROSTER_NAMES_NOT_CONFIGURED' });
  });

  it('refuses when no row matches the configured names', () => {
    const outcome = tracsisRotaParserV1.parse(
      grid(fixture('hfs-grid-revised.html'), ['Nobody Here'])
    );
    expect(outcome).toMatchObject({ ok: false, reason: 'ROSTER_ROW_NOT_FOUND' });
  });

  it('refuses when more than one row matches', () => {
    const html = fixture('hfs-grid-revised.html').replace('Sam Doe', 'Alex Rowan Junior');
    const outcome = tracsisRotaParserV1.parse(grid(html));
    expect(outcome).toMatchObject({ ok: false, reason: 'AMBIGUOUS_ROSTER_ROW' });
  });

  it('refuses a start time without an end time', () => {
    // Corrupt the self row's Sunday end cell (the last 19:00 in the file).
    const original = fixture('hfs-grid-revised.html');
    const at = original.lastIndexOf('<td>19:00</td>');
    expect(at).toBeGreaterThan(-1);
    const html = `${original.slice(0, at)}<td>RP</td>${original.slice(at + '<td>19:00</td>'.length)}`;
    const outcome = tracsisRotaParserV1.parse(grid(html));
    expect(outcome).toMatchObject({ ok: false });
    if (!outcome.ok) expect(outcome.reason).toContain('MALFORMED_CELL_PAIR');
  });
});

describe('tracsis parser v0 (kept runnable for re-parse comparisons)', () => {
  it('still refuses everything', () => {
    const outcome = tracsisRotaParserV0.parse(confirmation(fixture('confirmation-hands-free.txt')));
    expect(outcome).toMatchObject({ ok: false, reason: 'AWAITING_SAMPLE_EMAILS' });
  });
});
