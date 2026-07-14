import { PrismaClient } from '@prisma/client';
import { isoDate } from '../src/core/dates/iso-date';
import { createGlobalRepositories } from '../src/server/repositories';

/**
 * Seeds GLOBAL reference data only: statutory configuration per jurisdiction
 * and tax year. Employer templates are applied at onboarding (they belong to
 * a user), not at database seed time — see src/server/templates/.
 *
 * Provenance: every figure verified against gov.uk on 2026-07-13 (URLs in
 * each row's `source` field, surfaced by the engine). The verification
 * corrected two 2026-27 assumptions: the NI weekly Lower Earnings Limit
 * rises to £129, and student loan Plans 1/2/4 uprate annually (they are SLC
 * thresholds, not frozen personal-tax thresholds).
 * All money values are integer pence. Percentages are percent (8 = 8%).
 */

const GB_2025_26 = {
  version: 1,
  incomeTax: {
    // rUK (England & NI) bands over *taxable* income after the allowance.
    personalAllowancePence: 1_257_000,
    allowanceTaperThresholdPence: 10_000_000, // £100,000: −£1 allowance per £2 above
    bands: [
      { name: 'basic', ratePercent: 20, upToPence: 3_770_000 },
      { name: 'higher', ratePercent: 40, upToPence: 12_514_000 },
      { name: 'additional', ratePercent: 45, upToPence: null },
    ],
  },
  nationalInsurance: {
    employee: {
      // Class 1, per-period thresholds (weekly base; a fortnightly payroll
      // uses 2× weekly).
      weeklyLowerEarningsLimitPence: 12_500,
      weeklyPrimaryThresholdPence: 24_200,
      weeklyUpperEarningsLimitPence: 96_700,
      mainRatePercent: 8,
      upperRatePercent: 2,
      categories: { A: { mainRatePercent: 8, upperRatePercent: 2 } },
    },
  },
  studentLoans: {
    PLAN_1: { annualThresholdPence: 2_606_500, ratePercent: 9 },
    PLAN_2: { annualThresholdPence: 2_847_000, ratePercent: 9 },
    PLAN_4: { annualThresholdPence: 3_274_500, ratePercent: 9 },
    PLAN_5: { annualThresholdPence: 2_500_000, ratePercent: 9 },
    POSTGRAD: { annualThresholdPence: 2_100_000, ratePercent: 6 },
  },
  pensionAutoEnrolment: {
    qualifyingLowerAnnualPence: 624_000,
    qualifyingUpperAnnualPence: 5_027_000,
    defaultEmployeePercent: 5,
    defaultEmployerPercent: 3,
  },
} as const;

// Income tax thresholds frozen to April 2028 (official HMRC publication);
// NI PT/UEL and employee rates unchanged; pension band held for 2026-27 by
// the DWP review. Differences from 2025-26, per gov.uk: NI weekly LEL £129
// (was £125); student loan Plans 1/2/4 uprated.
const GB_2026_27 = {
  ...GB_2025_26,
  nationalInsurance: {
    employee: {
      ...GB_2025_26.nationalInsurance.employee,
      weeklyLowerEarningsLimitPence: 12_900,
    },
  },
  studentLoans: {
    PLAN_1: { annualThresholdPence: 2_690_000, ratePercent: 9 },
    PLAN_2: { annualThresholdPence: 2_938_500, ratePercent: 9 },
    PLAN_4: { annualThresholdPence: 3_379_500, ratePercent: 9 },
    PLAN_5: { annualThresholdPence: 2_500_000, ratePercent: 9 },
    POSTGRAD: { annualThresholdPence: 2_100_000, ratePercent: 6 },
  },
} as const;

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const { statutoryConfigs } = createGlobalRepositories(db);

    await statutoryConfigs.upsert({
      jurisdiction: 'GB',
      taxYear: '2025-26',
      effectiveFrom: isoDate('2025-04-06'),
      config: GB_2025_26,
      source:
        'Verified against gov.uk 2026-07-13: gov.uk/guidance/rates-and-thresholds-for-employers-2025-to-2026 (NI LEL £125/PT £242/UEL £967 wk, cat A 8%/2%); gov.uk/income-tax-rates (PA £12,570, bands 20/40/45); gov.uk/government/publications/sl3-student-loan-deduction-tables (P1 £26,065, P2 £28,470, P4 £32,745, PG £21,000); DWP AE review 2026/27 (QE band £6,240–£50,270 maintained from 2025-26)',
    });

    await statutoryConfigs.upsert({
      jurisdiction: 'GB',
      taxYear: '2026-27',
      effectiveFrom: isoDate('2026-04-06'),
      config: GB_2026_27,
      source:
        'Verified against gov.uk 2026-07-13: gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027 (NI LEL £129/PT £242/UEL £967 wk, cat A 8%/2%); PA £12,570 + basic limit £37,700 frozen to Apr 2028 (gov.uk/government/publications/the-personal-allowance-and-basic-rate-limit-for-income-tax-and-certain-national-insurance-contributions-nics-thresholds-from-6-april-2026-to-5-apr); student loans 2026-27 (P1 £26,900, P2 £29,385, P4 £33,795, P5 £25,000, PG £21,000: gov.uk SL3 deduction tables 2026-27); DWP AE review 2026/27 (QE band £6,240–£50,270, trigger £10,000 retained)',
    });

    console.log('Seeded statutory config: GB 2025-26, GB 2026-27');
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
