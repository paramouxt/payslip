import { describe, expect, it } from 'vitest';
import { tracsisRotaParserV1 } from './rota-parser';

describe('tracsisRotaParserV1', () => {
  it('parses Confirmation of Work emails and extracts role + external ref', () => {
    const parsed = tracsisRotaParserV1.parse({
      subject: 'Confirmation of Work — Reserved Parking',
      fromAddress: 'eventjobs@tracsis.com',
      receivedAt: new Date('2026-07-03T12:00:00.000Z'),
      plaintextBody: [
        'Reference: JOB-12345',
        '05/07/2026 09:00 - 18:00 9 hours',
        'Total Hours: 9',
      ].join('\n'),
      htmlBody: null,
      attachments: [],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.shifts).toEqual([
      {
        externalRef: 'JOB-12345',
        date: '2026-07-05',
        startTime: '09:00',
        endTime: '18:00',
        roleSlug: 'reserved-parking',
        venue: null,
        notes: null,
      },
    ]);
  });

  it('rejects contradictory arithmetic in confirmations', () => {
    const parsed = tracsisRotaParserV1.parse({
      subject: 'Confirmation of Work — Hands-Free',
      fromAddress: 'eventjobs@tracsis.com',
      receivedAt: new Date('2026-07-03T12:00:00.000Z'),
      plaintextBody: ['Reference: JOB-ABC', '05/07/2026 09:00 - 18:00 9 hours', 'Total Hours: 8'].join(
        '\n'
      ),
      htmlBody: null,
      attachments: [],
    });
    expect(parsed).toEqual({ ok: false, reason: 'CONTRADICTORY_ARITHMETIC' });
  });

  it('parses weekly HFS grid by roster name and ignores RP markers', () => {
    const parsed = tracsisRotaParserV1.parse({
      subject: 'HFS weekly rota w/c 06/07/2026',
      fromAddress: 'divya@tracsis.com',
      receivedAt: new Date('2026-07-04T12:00:00.000Z'),
      plaintextBody: null,
      htmlBody: `
        <table>
          <tr><th>Name</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Sun</th></tr>
          <tr><td>Divya Patel</td><td>11:00-18:00</td><td></td><td>RP</td><td>10:00-16:00</td><td></td><td></td><td></td></tr>
        </table>
      `,
      attachments: [],
      hints: { rosterNames: ['Divya'] },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.shifts).toHaveLength(2);
    expect(parsed.shifts.map((s) => s.date)).toEqual(['2026-07-06', '2026-07-09']);
    expect(parsed.shifts.map((s) => s.roleSlug)).toEqual(['hands-free', 'hands-free']);
  });
});
