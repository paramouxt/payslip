import { PrismaClient } from '@prisma/client';
import { isoDate } from '../src/core/dates/iso-date';
import { createGlobalRepositories } from '../src/server/repositories';

/**
 * Seeds GLOBAL reference data only: statutory configuration per jurisdiction
 * and tax year. Employer templates are applied at onboarding (they belong to
 * a user), not at database seed time — see src/server/templates/.
 *
 * ⚠ Provenance: figures seeded from engineering knowledge, to be re-verified
 * against gov.uk before Phase 8 (statutory engine) sign-off. The `source`
 * field records this status; the engine will surface it.
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

// Autumn Budget 2025: personal tax thresholds remain frozen; NI employee rates
// unchanged. Seeded identical to 2025-26 pending verification.
const GB_2026_27 = { ...GB_2025_26 } as const;

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
        'HMRC rates & thresholds 2025-26 — seeded from engineering knowledge 2026-07; VERIFY against gov.uk before Phase 8 sign-off',
    });

    await statutoryConfigs.upsert({
      jurisdiction: 'GB',
      taxYear: '2026-27',
      effectiveFrom: isoDate('2026-04-06'),
      config: GB_2026_27,
      source:
        'Assumed frozen per Autumn Budget 2025 — seeded 2026-07; VERIFY against gov.uk before Phase 8 sign-off',
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
