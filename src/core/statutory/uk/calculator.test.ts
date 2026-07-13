import { describe, expect, it } from 'vitest';
import { parseUkStatutoryConfig, type UkStatutoryConfig } from '../config';
import { ukPeriodIndexForPayDate, ukTaxYearOf } from './tax-year';
import { isoDate } from '../../dates/iso-date';
import { calculateUkStatutory, parseTaxCode, type UkStatutoryInput } from './calculator';

// Mirrors the 2025-26 seed (frozen thresholds; VERIFY vs gov.uk at sign-off).
const config: UkStatutoryConfig = parseUkStatutoryConfig({
  version: 1,
  incomeTax: {
    personalAllowancePence: 1_257_000,
    allowanceTaperThresholdPence: 10_000_000,
    bands: [
      { name: 'basic', ratePercent: 20, upToPence: 3_770_000 },
      { name: 'higher', ratePercent: 40, upToPence: 12_514_000 },
      { name: 'additional', ratePercent: 45, upToPence: null },
    ],
  },
  nationalInsurance: {
    employee: {
      weeklyLowerEarningsLimitPence: 12_500,
      weeklyPrimaryThresholdPence: 24_200,
      weeklyUpperEarningsLimitPence: 96_700,
      mainRatePercent: 8,
      upperRatePercent: 2,
      categories: { A: { mainRatePercent: 8, upperRatePercent: 2 } },
    },
  },
  studentLoans: {
    PLAN_2: { annualThresholdPence: 2_847_000, ratePercent: 9 },
  },
  pensionAutoEnrolment: {
    qualifyingLowerAnnualPence: 624_000,
    qualifyingUpperAnnualPence: 5_027_000,
    defaultEmployeePercent: 5,
    defaultEmployerPercent: 3,
  },
});

const profileA = {
  taxCode: '1257L',
  taxBasis: 'CUMULATIVE' as const,
  niCategory: 'A',
  pension: null,
  studentLoan: null,
};

function input(overrides: Partial<UkStatutoryInput>): UkStatutoryInput {
  return {
    periodGrossPence: 60_000, // £600 fortnight
    periodIndex: 3,
    periodsPerYear: 26,
    profile: profileA,
    config,
    ytdAnchor: null,
    ...overrides,
  };
}

describe('tax year & period math', () => {
  it('maps dates to UK tax years', () => {
    expect(ukTaxYearOf(isoDate('2026-04-05')).taxYear).toBe('2025-26');
    expect(ukTaxYearOf(isoDate('2026-04-06')).taxYear).toBe('2026-27');
    expect(ukTaxYearOf(isoDate('2027-01-01')).taxYear).toBe('2026-27');
  });

  it('maps paydays to fortnightly statutory periods (Tracsis: 6 May 2026 → period 3)', () => {
    expect(ukPeriodIndexForPayDate(isoDate('2026-05-06'), 26)).toEqual({
      taxYear: '2026-27',
      periodIndex: 3,
    });
    expect(ukPeriodIndexForPayDate(isoDate('2026-04-06'), 26).periodIndex).toBe(1);
    expect(ukPeriodIndexForPayDate(isoDate('2026-04-22'), 26).periodIndex).toBe(2);
  });
});

describe('parseTaxCode', () => {
  it('parses standard, flat, K, and unknown codes', () => {
    expect(parseTaxCode('1257L')).toMatchObject({
      kind: 'ALLOWANCE',
      annualAllowancePence: 1_257_000,
    });
    expect(parseTaxCode('BR')).toMatchObject({ flatBandName: 'basic' });
    expect(parseTaxCode('K475')).toMatchObject({ kind: 'K', annualAllowancePence: -475_000 });
    expect(parseTaxCode('0T')).toMatchObject({ annualAllowancePence: 0 });
    expect(parseTaxCode('WAT?').note).toContain('not recognised');
  });
});

describe('calculateUkStatutory', () => {
  it('without a profile: zero deductions with an honest explanation, never a guess', () => {
    const result = calculateUkStatutory(input({ profile: null }));
    expect(result.taxPence).toBe(0);
    expect(result.netPence).toBe(60_000);
    expect(result.explanation.detail).toContain('No tax profile');
  });

  it('cumulative PAYE below the apportioned allowance is £0', () => {
    // £600 by period 3: allowance to date = 1257000 × 3/26 = £1,450.38 > £600 YTD.
    const result = calculateUkStatutory(input({}));
    expect(result.taxPence).toBe(0);
    expect(result.niPence).toBe(
      Math.round((60_000 - 2 * 24_200) * 0.08) // £116 NIable × 8% = £9.28
    );
    expect(result.netPence).toBe(60_000 - result.niPence);
  });

  it('cumulative PAYE with a YTD anchor: tax due to date minus tax paid', () => {
    // Period 10, £1,000 this period, £9,000 gross / £700 tax already (anchor).
    const result = calculateUkStatutory(
      input({
        periodIndex: 10,
        periodGrossPence: 100_000,
        ytdAnchor: { grossPence: 900_000, taxPence: 70_000, source: 'payslip 12 Sep' },
      })
    );
    // Allowance to date: 1257000 × 10/26 = 483461 (floor). Taxable = 1000000 − 483461 = 516539.
    // Basic band cap 3770000 × 10/26 = 1450000 > taxable ⇒ all at 20% = 103308 (HALF_UP).
    // Tax this period = 103308 − 70000 = 33308.
    expect(result.taxPence).toBe(33_308);
  });

  it('W1/M1 basis taxes each period in isolation', () => {
    const result = calculateUkStatutory(
      input({
        profile: { ...profileA, taxBasis: 'WEEK1MONTH1' },
        periodGrossPence: 100_000,
      })
    );
    // Period allowance 1257000/26 = 48346 (floor). Taxable 51654 × 20% = 10331 (HALF_UP).
    expect(result.taxPence).toBe(10_331);
  });

  it('BR code taxes everything at basic rate', () => {
    const result = calculateUkStatutory(
      input({ profile: { ...profileA, taxCode: 'BR' }, periodGrossPence: 100_000 })
    );
    expect(result.taxPence).toBe(20_000);
  });

  it('NI charges 2% above the UEL', () => {
    const result = calculateUkStatutory(input({ periodGrossPence: 250_000 }));
    // PT 48400, UEL 193400: main (193400−48400)×8% = 11600; upper (250000−193400)×2% = 1132.
    expect(result.niPence).toBe(11_600 + 1_132);
  });

  it('qualifying-earnings pension and whole-pound student loan', () => {
    const result = calculateUkStatutory(
      input({
        periodGrossPence: 150_000,
        profile: {
          ...profileA,
          pension: { kind: 'QUALIFYING_EARNINGS', employeePercent: 5 },
          studentLoan: 'PLAN_2',
        },
      })
    );
    // Pension: lower 624000/26=24000, upper 5027000/26=193346.15…;
    // base = 150000−24000 = 126000 × 5% = 6300.
    expect(result.pensionPence).toBe(6_300);
    // Loan: threshold 2847000/26 = 109500; excess 40500 × 9% = 3645 → floor to £36.00.
    expect(result.studentLoanPence).toBe(3_600);
    expect(result.netPence).toBe(150_000 - result.taxPence - result.niPence - 6_300 - 3_600);
  });

  it('every figure carries an explanation node', () => {
    const result = calculateUkStatutory(input({ periodGrossPence: 150_000 }));
    expect(result.explanation.children?.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(result.explanation)).toContain('period 3/26');
  });
});
