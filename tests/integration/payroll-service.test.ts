import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { isoDate } from '@/core/dates/iso-date';
import { instantFromZoned } from '@/core/dates/zoned';
import { resolvePeriodFor } from '@/core/domain/payroll-period/scheme';
import { Shift } from '@/core/domain/shift/shift';
import { noopRealtimePublisher } from '@/server/integrations/realtime/publisher';
import { createPayrollService, type PayrollService } from '@/server/services/payroll-service';
import {
  createGlobalRepositories,
  createTenantRepositories,
  type TenantRepositories,
} from '@/server/repositories';
import type { PayrollPeriodRecord } from '@/server/repositories/ports';
import { buildTracsisEmployerTemplate } from '@/server/templates/tracsis';

const url = process.env.TEST_DATABASE_URL;

/**
 * The full Phase 8 loop against real Postgres: shifts → engine → ExpectedPay
 * projection (with provenance + explanation tree) → payslip → reconciliation
 * → discrepancies.
 */
describe.skipIf(!url)('payroll service (Postgres)', () => {
  let db: PrismaClient;
  let repos: TenantRepositories;
  let service: PayrollService;
  let userId: string;
  let employerId: string;
  let contractId: string;
  let period: PayrollPeriodRecord;
  const tz = 'Europe/London';

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    const user = await db.user.create({ data: { email: `payroll-${randomUUID()}@test.local` } });
    userId = user.id;
    const tenant = { userId };
    repos = createTenantRepositories(db, tenant);
    service = createPayrollService({ db, realtime: noopRealtimePublisher });

    ({ employerId } = await repos.employers.createFromConfig(buildTracsisEmployerTemplate()));
    const contract = await repos.contracts.create({
      employerId,
      startDate: isoDate('2026-04-06'),
    });
    contractId = contract.id;

    // Seed statutory config for the 2026-27 tax year (as prisma/seed.ts does).
    const globals = createGlobalRepositories(db);
    await globals.statutoryConfigs.upsert({
      jurisdiction: 'GB',
      taxYear: '2026-27',
      effectiveFrom: isoDate('2026-04-06'),
      config: {
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
        studentLoans: {},
        pensionAutoEnrolment: {
          qualifyingLowerAnnualPence: 624_000,
          qualifyingUpperAnnualPence: 5_027_000,
          defaultEmployeePercent: 5,
          defaultEmployerPercent: 3,
        },
      },
      source: 'test fixture',
    });

    await repos.taxProfiles.upsert({
      jurisdiction: 'GB',
      taxYear: '2026-27',
      taxCode: '1257L',
      taxBasis: 'CUMULATIVE',
      niCategory: 'A',
      pension: null,
      studentLoan: null,
    });

    const template = buildTracsisEmployerTemplate();
    const span = resolvePeriodFor(template.payPeriodScheme, isoDate('2026-06-20'));
    period = await repos.payrollPeriods.ensure(employerId, span);

    const loaded = await repos.employers.getConfig(employerId);
    const roleId = loaded!.roleIdsBySlug['hands-free']!;
    // Two shifts in the period: Sat 20 Jun 8h (hands-free rates) and
    // Sun 21 Jun 8h (Sunday rule ⇒ reserved-parking rates).
    for (const date of ['2026-06-20', '2026-06-21'] as const) {
      const d = isoDate(date);
      const { shift, event } = Shift.create({
        identity: {
          id: `shift_${randomUUID()}`,
          userId,
          employerId,
          contractId,
        },
        details: {
          externalRef: null,
          date: d,
          startAt: instantFromZoned(d, '09:00', tz),
          endAt: instantFromZoned(d, '17:00', tz),
          timezone: tz,
          roleId,
          venue: 'Bicester Village',
          notes: null,
        },
        evidence: { actor: 'user', occurredAt: new Date() },
      });
      await repos.shifts.create(shift, event);
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('computes ExpectedPay with penny-exact gross, provenance, and explanation tree', async () => {
    const { expectedPayId } = await service.recomputePeriod({ userId }, employerId, period);
    const current = await repos.expectedPay.currentForPeriod(period.id);
    expect(current?.id).toBe(expectedPayId);

    // Sat: 8h × £13.88 + 8 × £1.68 = 111.04 + 13.44 = 124.48
    // Sun: 8h × £15.06 + 8 × £1.82 = 120.48 + 14.56 = 135.04  ⇒ gross £259.52
    expect(current!.grossPence).toBe(12_448 + 13_504);

    // £259.52 YTD is far below the apportioned allowance ⇒ PAYE £0.
    // NI: gross < 2×PT ⇒ £0.
    expect(current!.taxPence).toBe(0);
    expect(current!.niPence).toBe(0);
    expect(current!.netPence).toBe(current!.grossPence);

    expect(current!.engineVersion).toContain('1.0.0');
    expect(current!.ruleSetVersion).toBe(1);
    expect(current!.statutoryConfigId).not.toBeNull();
    expect(JSON.stringify(current!.lines)).toContain('Sunday');
  });

  it('supersedes rather than overwrites on recompute', async () => {
    await service.recomputePeriod({ userId }, employerId, period);
    const history = await repos.expectedPay.historyForPeriod(period.id);
    expect(history.length).toBeGreaterThanOrEqual(2);
    const current = await repos.expectedPay.currentForPeriod(period.id);
    expect(current).not.toBeNull();
  });

  it('reconciles a short payslip into a MAJOR discrepancy + notification', async () => {
    // Payslip £124.48 gross — exactly one missing Sunday shift (£135.04 short).
    await repos.payslips.create({
      employerId,
      contractId,
      payrollPeriodId: period.id,
      payDate: period.expectedPayDate,
      grossPence: 12_448,
      taxPence: 0,
      niPence: 0,
      pensionPence: 0,
      netPence: 12_448,
      ytd: null,
    });
    const { discrepancies } = await service.recomputePeriod({ userId }, employerId, period);
    expect(discrepancies).toBe(2); // gross + net both short

    const open = await repos.discrepancies.list({ status: 'OPEN' });
    const major = open.filter((d) => d.severity === 'MAJOR');
    expect(major).toHaveLength(2);
    expect(major[0]!.deltaPence).toBe(-13_504);
    expect(major[0]!.summary).toContain('£135.04');

    const unread = await repos.notifications.listUnread();
    expect(unread.some((n) => n.type === 'DISCREPANCY_FOUND')).toBe(true);

    // Re-reconciling replaces OPEN rows instead of duplicating them.
    await service.recomputePeriod({ userId }, employerId, period);
    const openAfter = await repos.discrepancies.list({ status: 'OPEN' });
    expect(openAfter.filter((d) => d.severity === 'MAJOR')).toHaveLength(2);
  });

  it('cancelled shifts drop out of expectation on recompute', async () => {
    const shifts = await repos.shifts.listBetween(period.startDate, period.endDate, {
      employerId,
    });
    const sunday = shifts.find((s) => s.snapshot.date === '2026-06-21')!;
    const cancelled = sunday.cancel({ actor: 'user', occurredAt: new Date() });
    await repos.shifts.applyEvent(cancelled.shift, cancelled.event);

    await service.recomputePeriod({ userId }, employerId, period);
    const current = await repos.expectedPay.currentForPeriod(period.id);
    expect(current!.grossPence).toBe(12_448); // Sunday gone
    // Expectation now matches the payslip: no MAJOR discrepancies remain open.
    const open = await repos.discrepancies.list({ status: 'OPEN' });
    expect(open.filter((d) => d.severity === 'MAJOR')).toHaveLength(0);
  });
});
