import { z } from 'zod';
import { DomainError } from '../errors';

/**
 * Statutory tables are DATA per (jurisdiction, taxYear) — never constants in
 * code (constitution §2.6 / ADR 7). This schema validates what the seeds and
 * any future admin UI store. All money integer pence; percents are percents.
 */
export const ukStatutoryConfigSchema = z.object({
  version: z.literal(1),
  incomeTax: z.object({
    personalAllowancePence: z.number().int().nonnegative(),
    allowanceTaperThresholdPence: z.number().int().positive(),
    bands: z
      .array(
        z.object({
          name: z.string(),
          ratePercent: z.number().nonnegative(),
          upToPence: z.number().int().positive().nullable(),
        })
      )
      .min(1),
  }),
  nationalInsurance: z.object({
    employee: z.object({
      weeklyLowerEarningsLimitPence: z.number().int().nonnegative(),
      weeklyPrimaryThresholdPence: z.number().int().nonnegative(),
      weeklyUpperEarningsLimitPence: z.number().int().positive(),
      mainRatePercent: z.number().nonnegative(),
      upperRatePercent: z.number().nonnegative(),
      categories: z.record(
        z.string(),
        z.object({
          mainRatePercent: z.number().nonnegative(),
          upperRatePercent: z.number().nonnegative(),
        })
      ),
    }),
  }),
  studentLoans: z.record(
    z.string(),
    z.object({
      annualThresholdPence: z.number().int().nonnegative(),
      ratePercent: z.number().nonnegative(),
    })
  ),
  pensionAutoEnrolment: z.object({
    qualifyingLowerAnnualPence: z.number().int().nonnegative(),
    qualifyingUpperAnnualPence: z.number().int().positive(),
    defaultEmployeePercent: z.number().nonnegative(),
    defaultEmployerPercent: z.number().nonnegative(),
  }),
});

export type UkStatutoryConfig = z.infer<typeof ukStatutoryConfigSchema>;

export function parseUkStatutoryConfig(raw: unknown): UkStatutoryConfig {
  const result = ukStatutoryConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new DomainError(`invalid statutory config: ${result.error.message}`, 'CONFIG_INVALID');
  }
  return result.data;
}
