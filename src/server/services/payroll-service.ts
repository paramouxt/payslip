import type { PrismaClient } from '@/generated/prisma/client';
import { z } from 'zod';
import { isoDate, type IsoDate } from '@/core/dates/iso-date';
import { resolvePeriodFor } from '@/core/domain/payroll-period/scheme';
import {
  computePeriodGross,
  PAYROLL_ENGINE_VERSION,
  type EngineEmployerConfig,
  type ShiftPricingInput,
} from '@/core/payroll/engine';
import type { ExplanationNode } from '@/core/payroll/explanation';
import { parseUkStatutoryConfig } from '@/core/statutory/config';
import {
  calculateUkStatutory,
  UK_STATUTORY_ENGINE_VERSION,
  type UkTaxProfile,
} from '@/core/statutory/uk/calculator';
import { ukPeriodIndexForPayDate, ukTaxYearOf } from '@/core/statutory/uk/tax-year';
import { reconcileTotals } from '@/core/reconciliation/reconcile';
import type { RealtimePublisher } from '@/server/integrations/realtime/publisher';
import type { PayrollProjector } from '@/server/services/ingestion-service';
import { createGlobalRepositories, createTenantRepositories } from '@/server/repositories';
import { notifyUser } from '@/server/services/notification-service';
import type { PayrollPeriodRecord } from '@/server/repositories/ports';
import type { TenantContext } from '@/server/tenant';

/**
 * Orchestrates the deterministic engines (constitution §4.3): loads roster +
 * employer config + statutory data, runs the pure engines, persists the
 * ExpectedPay projection (superseding, never overwriting), reconciles against
 * a payslip when one exists, and raises discrepancies. Contains no pay
 * arithmetic of its own — that lives in src/core, tested to the penny.
 */

const pensionSchema = z
  .object({
    kind: z.enum(['QUALIFYING_EARNINGS', 'WHOLE_PAY']),
    employeePercent: z.number().nonnegative(),
  })
  .nullable();

export interface PayrollServiceDeps {
  db: PrismaClient;
  realtime: RealtimePublisher;
}

export function createPayrollService({ db, realtime }: PayrollServiceDeps) {
  const globals = createGlobalRepositories(db);

  async function recomputePeriod(
    tenant: TenantContext,
    employerId: string,
    period: PayrollPeriodRecord
  ): Promise<{ expectedPayId: string; discrepancies: number }> {
    const repos = createTenantRepositories(db, tenant);
    const loaded = await repos.employers.getConfig(employerId);
    if (!loaded) throw new Error('employer not found for tenant');
    const config = loaded.config;

    const roleSlugById = new Map(Object.entries(loaded.roleIdsBySlug).map(([s, id]) => [id, s]));
    const rateClassSlugById = new Map(
      Object.entries(loaded.rateClassIdsBySlug).map(([s, id]) => [id, s])
    );
    const roleDefaultBySlug = new Map(
      config.roles.map((r) => [r.slug, r.defaultRateClassSlug] as const)
    );

    const allShifts = await repos.shifts.listBetween(period.startDate, period.endDate, {
      employerId,
    });
    const workedShifts = allShifts.filter((s) => s.status !== 'CANCELLED');

    const pricingInputs: ShiftPricingInput[] = workedShifts.map((shift) => {
      const s = shift.snapshot;
      const roleSlug = s.roleId ? (roleSlugById.get(s.roleId) ?? null) : null;
      return {
        shiftId: shift.id,
        date: s.date,
        scheduledHours: shift.scheduledHours,
        roleSlug,
        roleDefaultRateClassSlug: roleSlug ? (roleDefaultBySlug.get(roleSlug) ?? null) : null,
        overrideRateClassSlug: s.rateClassOverrideId
          ? (rateClassSlugById.get(s.rateClassOverrideId) ?? null)
          : null,
        venue: s.venue,
      };
    });

    const engineConfig: EngineEmployerConfig = {
      currency: config.currency,
      rateClasses: config.rateClasses,
      rules: config.rules,
      roundingPolicy: config.roundingPolicy,
    };
    const gross = computePeriodGross(pricingInputs, engineConfig);

    // Statutory estimation keyed by PAYMENT date (UK PAYE convention).
    const periodsPerYear =
      config.payPeriodScheme.lengthDays === 14
        ? 26
        : config.payPeriodScheme.lengthDays === 7
          ? 52
          : 12;
    const { taxYear, periodIndex } = ukPeriodIndexForPayDate(
      period.expectedPayDate,
      periodsPerYear
    );
    const { startsOn } = ukTaxYearOf(period.expectedPayDate);

    let statutoryConfigId: string | null = null;
    let ytdAnchorPayslipId: string | null = null;
    let statutory: ReturnType<typeof calculateUkStatutory>;

    const configRow =
      config.jurisdiction === 'GB' ? await globals.statutoryConfigs.get('GB', taxYear) : null;
    if (!configRow) {
      statutory = {
        taxPence: 0,
        niPence: 0,
        pensionPence: 0,
        studentLoanPence: 0,
        netPence: gross.grossPence,
        explanation: {
          label: `Statutory deductions — no ${config.jurisdiction} tables for ${taxYear}`,
          amountPence: 0,
          detail: 'Deductions estimated at £0 until statutory configuration is seeded/verified.',
        },
      };
    } else {
      statutoryConfigId = configRow.id;
      const profileRow = await repos.taxProfiles.get('GB', taxYear);
      const profile: UkTaxProfile | null = profileRow
        ? {
            taxCode: profileRow.taxCode,
            taxBasis: profileRow.taxBasis,
            niCategory: profileRow.niCategory,
            pension: pensionSchema.parse(profileRow.pension ?? null),
            studentLoan: profileRow.studentLoan,
          }
        : null;

      const anchorAgg = await repos.payslips.aggregateBefore(
        employerId,
        period.expectedPayDate,
        startsOn
      );
      ytdAnchorPayslipId = anchorAgg.latestId;
      const latestYtd = z
        .object({ grossPence: z.number().int(), taxPence: z.number().int() })
        .nullish()
        .catch(null)
        .parse(anchorAgg.latestYtd);
      const anchor =
        anchorAgg.count === 0
          ? null
          : latestYtd
            ? {
                grossPence: latestYtd.grossPence,
                taxPence: latestYtd.taxPence,
                source: 'YTD figures from latest payslip',
              }
            : {
                grossPence: anchorAgg.sumGrossPence,
                taxPence: anchorAgg.sumTaxPence,
                source: `sum of ${anchorAgg.count.toString()} payslip(s) this tax year`,
              };

      statutory = calculateUkStatutory({
        periodGrossPence: gross.grossPence,
        periodIndex,
        periodsPerYear,
        profile,
        config: parseUkStatutoryConfig(configRow.config),
        ytdAnchor: anchor,
      });
    }

    const lines: { gross: ExplanationNode; statutory: ExplanationNode } = {
      gross: gross.explanation,
      statutory: statutory.explanation,
    };

    const { id: expectedPayId } = await repos.expectedPay.supersedeAndCreate({
      payrollPeriodId: period.id,
      engineVersion: `${PAYROLL_ENGINE_VERSION}+uk${UK_STATUTORY_ENGINE_VERSION}`,
      ruleSetVersion: loaded.activeRuleSetVersion,
      statutoryConfigId,
      ytdAnchorPayslipId,
      grossPence: gross.grossPence,
      taxPence: statutory.taxPence,
      niPence: statutory.niPence,
      pensionPence: statutory.pensionPence + statutory.studentLoanPence,
      netPence: statutory.netPence,
      lines,
    });

    // Reconcile when the real payslip is in.
    let discrepancyCount = 0;
    const payslip = await repos.payslips.forPeriod(period.id);
    if (payslip) {
      const drafts = reconcileTotals(
        {
          grossPence: gross.grossPence,
          taxPence: statutory.taxPence,
          niPence: statutory.niPence,
          pensionPence: statutory.pensionPence,
          netPence: statutory.netPence,
        },
        {
          grossPence: payslip.grossPence,
          taxPence: payslip.taxPence,
          niPence: payslip.niPence,
          pensionPence: payslip.pensionPence,
          netPence: payslip.netPence,
        }
      );
      const created = await repos.discrepancies.replaceOpenForPeriod(
        period.id,
        payslip.id,
        drafts.map((d) => ({
          ...d,
          evidence: { expectedPayId, payslipId: payslip.id, periodId: period.id },
        }))
      );
      discrepancyCount = created.length;
      const material = created.filter((d) => d.severity !== 'INFO');
      if (material.length > 0) {
        await notifyUser(db, tenant.userId, 'DISCREPANCY_FOUND', {
          periodId: period.id,
          count: material.length,
          summary: material[0]?.summary ?? '',
        });
      }
    }

    await realtime.broadcast(tenant.userId, 'payroll', {
      periodId: period.id,
      expectedPayId,
      discrepancies: discrepancyCount,
    });
    return { expectedPayId, discrepancies: discrepancyCount };
  }

  const projector: PayrollProjector = {
    async recomputePeriodsTouching(userId, employerId, dates) {
      const tenant: TenantContext = { userId };
      const repos = createTenantRepositories(db, tenant);
      const loaded = await repos.employers.getConfig(employerId);
      if (!loaded) return;
      const seen = new Set<number>();
      for (const raw of dates) {
        let span;
        try {
          span = resolvePeriodFor(loaded.config.payPeriodScheme, isoDate(raw));
        } catch {
          continue; // date outside the scheme — nothing to recompute
        }
        if (seen.has(span.sequence)) continue;
        seen.add(span.sequence);
        const period = await repos.payrollPeriods.ensure(employerId, span);
        await recomputePeriod(tenant, employerId, period);
      }
    },
  };

  return {
    recomputePeriod,
    projector,
    /** Recompute the period a date falls in (manual entry points). */
    async recomputeForDate(tenant: TenantContext, employerId: string, date: IsoDate) {
      await projector.recomputePeriodsTouching(tenant.userId, employerId, [date]);
    },
  };
}

export type PayrollService = ReturnType<typeof createPayrollService>;
