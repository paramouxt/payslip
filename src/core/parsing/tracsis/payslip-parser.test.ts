import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PayslipParseInput } from '../types';
import { tracsisPayslipParserV1 } from './payslip-parser';

const fixture = (name: string): string =>
  readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'tracsis', name), 'utf8');

const input = (textContent: string): PayslipParseInput => ({
  filename: 'anonymised-payslip.pdf',
  mimeType: 'application/pdf',
  textContent,
});

describe('Tracsis payslip parser v1', () => {
  it.each([
    {
      file: 'payslip-period-11.txt',
      payDate: '2026-06-17',
      taxPeriod: 11,
      grossPence: 64_616,
      taxPence: 3_680,
      niPence: 1_297,
      pensionPence: 0,
      netPence: 59_639,
      ytdGrossPence: 327_616,
    },
    {
      file: 'payslip-period-13.txt',
      payDate: '2026-07-01',
      taxPeriod: 13,
      grossPence: 94_548,
      taxPence: 9_680,
      niPence: 3_692,
      pensionPence: 0,
      netPence: 81_176,
      ytdGrossPence: 422_164,
    },
    {
      file: 'payslip-period-15.txt',
      payDate: '2026-07-15',
      taxPeriod: 15,
      grossPence: 145_800,
      taxPence: 19_920,
      niPence: 7_792,
      pensionPence: 4_872,
      netPence: 113_216,
      ytdGrossPence: 567_964,
    },
  ])('parses $file to exact integer-pence totals', (expected) => {
    const outcome = tracsisPayslipParserV1.parse(input(fixture(expected.file)));
    if (!outcome.ok) throw new Error(`expected parse success, got ${outcome.reason}`);

    expect(outcome.confidence).toBe(1);
    expect(outcome.payslip).toMatchObject({
      payDate: expected.payDate,
      taxPeriod: expected.taxPeriod,
      taxCode: '1200L',
      paymentPeriod: 'FORTNIGHTLY',
      grossPence: expected.grossPence,
      taxPence: expected.taxPence,
      niPence: expected.niPence,
      pensionPence: expected.pensionPence,
      netPence: expected.netPence,
      ytd: { grossPence: expected.ytdGrossPence },
    });
    expect(outcome.payslip.lines).toHaveLength(4);
    expect(outcome.payslip.lines.map((line) => [line.roleSlug, line.kind])).toEqual([
      ['hands-free', 'BASE'],
      ['reserved-parking', 'BASE'],
      ['hands-free', 'HOLIDAY'],
      ['reserved-parking', 'HOLIDAY'],
    ]);
  });

  it('refuses when earning lines do not add to printed gross', () => {
    const text = fixture('payslip-period-13.txt').replace(
      'Total Gross Pay 945.48',
      'Total Gross Pay 945.49'
    );
    expect(tracsisPayslipParserV1.parse(input(text))).toEqual({
      ok: false,
      reason: 'EARNINGS_DO_NOT_MATCH_GROSS',
    });
  });

  it('refuses when deductions do not reconcile to printed net', () => {
    const text = fixture('payslip-period-13.txt').replace(/811\.76\s*$/, '811.75');
    expect(tracsisPayslipParserV1.parse(input(text))).toEqual({
      ok: false,
      reason: 'DEDUCTIONS_DO_NOT_MATCH_NET',
    });
  });

  it('refuses unknown earning codes rather than guessing a role', () => {
    const text = fixture('payslip-period-13.txt').replace('TIERBV2H Wage', 'TIERBV9H Wage');
    expect(tracsisPayslipParserV1.parse(input(text))).toEqual({
      ok: false,
      reason: 'UNKNOWN_OR_MISSING_EARNING_LINE',
    });
  });

  it('refuses non-PDF attachments', () => {
    const outcome = tracsisPayslipParserV1.parse({
      ...input(fixture('payslip-period-13.txt')),
      filename: 'payslip.txt',
      mimeType: 'text/plain',
    });
    expect(outcome).toEqual({ ok: false, reason: 'NOT_A_PDF' });
  });
});
