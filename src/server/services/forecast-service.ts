import type { PrismaClient } from '@prisma/client';
import {
  addDays,
  compareIsoDates,
  diffDays,
  fromUtcInstant,
  type IsoDate,
} from '@/core/dates/iso-date';
import { periodsBetween } from '@/core/domain/payroll-period/scheme';
import { roundToInt } from '@/core/money/money';
import { parseUkStatutoryConfig } from '@/core/statutory/config';
import { ukTaxYearOf } from '@/core/statutory/uk/tax-year';
import { createGlobalRepositories, createTenantRepositories } from '@/server/repositories';
import type { TenantContext } from '@/server/tenant';

/**
 * Tax-year forecast with COMPOSITION HONESTY: every pound is labelled actual
 * (payslip-backed), scheduled (engine-computed expectation), or projected
 * (statistical assumption). This is deterministic arithmetic — the future AI
 * layer narrates it, never replaces it (§6).
 */
export interface TaxYearForecast {
  taxYear: string;
  actualPence: number;
  scheduledPence: number;
  projectedPence: number;
  totalGrossPence: number;
  estimatedTaxPence: number;
  estimatedNetPence: number;
  assumptions: string[];
}

export function createForecastService(db: PrismaClient) {
  const globals = createGlobalRepositories(db);

  return {
    async taxYearForecast(
      tenant: TenantContext,
      employerId: string,
      today: IsoDate = fromUtcInstant(new Date())
    ): Promise<TaxYearForecast | null> {
      const repos = createTenantRepositories(db, tenant);
      const loaded = await repos.employers.getConfig(employerId);
      if (!loaded) return null;
      const { taxYear, startsOn } = ukTaxYearOf(today);
      const yearEnd = addDays(startsOn, 364);
      const assumptions: string[] = [];

      // Actuals: payslips paid so far this tax year.
      const payslips = (await repos.payslips.list()).filter(
        (p) =>
          p.employerId === employerId &&
          compareIsoDates(p.payDate, startsOn) >= 0 &&
          compareIsoDates(p.payDate, today) <= 0
      );
      const actualPence = payslips.reduce((a, p) => a + p.grossPence, 0);
      const paidPeriodIds = new Set(payslips.map((p) => p.payrollPeriodId));

      // Scheduled: current engine expectations for periods paying in-year that
      // have no payslip yet.
      let scheduledPence = 0;
      let lastComputedPayDate: IsoDate = today;
      let recentComputed: { grossPence: number; lengthDays: number }[] = [];
      try {
        const spans = periodsBetween(loaded.config.payPeriodScheme, startsOn, yearEnd).filter(
          (s) =>
            compareIsoDates(s.payDate, startsOn) >= 0 && compareIsoDates(s.payDate, yearEnd) <= 0
        );
        for (const span of spans) {
          const periodRecord = await repos.payrollPeriods.ensure(employerId, span);
          const expected = await repos.expectedPay.currentForPeriod(periodRecord.id);
          if (!expected) continue;
          if (!paidPeriodIds.has(periodRecord.id) && expected.grossPence > 0) {
            scheduledPence += expected.grossPence;
            if (compareIsoDates(span.payDate, lastComputedPayDate) > 0) {
              lastComputedPayDate = span.payDate;
            }
          }
          recentComputed.push({
            grossPence: expected.grossPence,
            lengthDays: diffDays(span.startDate, span.endDate) + 1,
          });
        }
      } catch {
        assumptions.push('Pay period scheme does not cover the whole tax year.');
      }

      // Projection: average computed weekly gross extended over the remaining
      // uncovered weeks. A user-tunable assumption panel is the natural next step.
      recentComputed = recentComputed.slice(-4);
      const weeklyAvg =
        recentComputed.length > 0
          ? recentComputed.reduce((a, p) => a + (p.grossPence / p.lengthDays) * 7, 0) /
            recentComputed.length
          : 0;
      const remainingDays = Math.max(0, diffDays(lastComputedPayDate, yearEnd));
      const projectedPence = roundToInt((weeklyAvg * remainingDays) / 7, 'HALF_UP');
      assumptions.push(
        recentComputed.length > 0
          ? `Projection assumes ~£${(weeklyAvg / 100).toFixed(2)}/week (average of your last ${recentComputed.length.toString()} computed periods) for the remaining ${Math.round(remainingDays / 7).toString()} weeks.`
          : 'No computed periods yet — projection is £0 until shifts exist.'
      );

      const totalGrossPence = actualPence + scheduledPence + projectedPence;

      // Whole-year statutory estimate on the projected annual gross.
      let estimatedTaxPence = 0;
      const configRow = await globals.statutoryConfigs.get('GB', taxYear);
      const profile = await repos.taxProfiles.get('GB', taxYear);
      if (configRow && profile) {
        const cfg = parseUkStatutoryConfig(configRow.config);
        const codeMatch = /^(\d+)[LMN]$/.exec(profile.taxCode.toUpperCase());
        const allowance = codeMatch ? Number(codeMatch[1]) * 1000 : 0;
        let taxable = Math.max(0, totalGrossPence - allowance);
        let lower = 0;
        for (const band of cfg.incomeTax.bands) {
          const upper = band.upToPence ?? Number.POSITIVE_INFINITY;
          const slice = Math.max(0, Math.min(taxable, upper - lower));
          estimatedTaxPence += roundToInt((slice * band.ratePercent) / 100, 'HALF_UP');
          taxable -= slice;
          lower = upper;
          if (taxable <= 0) break;
        }
        const weeklyGross = totalGrossPence / 52;
        const ni = cfg.nationalInsurance.employee;
        const weeklyNiable = Math.max(
          0,
          Math.min(weeklyGross, ni.weeklyUpperEarningsLimitPence) - ni.weeklyPrimaryThresholdPence
        );
        estimatedTaxPence += roundToInt(weeklyNiable * 52 * (ni.mainRatePercent / 100), 'HALF_UP');
        assumptions.push(
          'Tax & NI estimated on the annual total, spread evenly — an approximation.'
        );
      } else {
        assumptions.push('Add a tax profile in Settings for tax/NI in this forecast.');
      }

      return {
        taxYear,
        actualPence,
        scheduledPence,
        projectedPence,
        totalGrossPence,
        estimatedTaxPence,
        estimatedNetPence: totalGrossPence - estimatedTaxPence,
        assumptions,
      };
    },
  };
}

export type ForecastService = ReturnType<typeof createForecastService>;
