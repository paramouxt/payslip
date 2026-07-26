import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { TenantContext } from '@/server/tenant';
import type {
  DiscrepancyRecord,
  DiscrepancyRepository,
  ExpectedPayRepository,
  ExpectedPaySnapshot,
  PayslipRecord,
  PayslipRepository,
  TaxProfileRepository,
} from '../ports';
import { fromDbDate, toDbDate } from './mappers';

/** ExpectedPay, Payslip, Discrepancy, TaxProfile — the payroll projections. */

export function createPrismaExpectedPayRepository(
  db: PrismaClient,
  tenant: TenantContext
): ExpectedPayRepository {
  const { userId } = tenant;

  function toSnapshot(row: {
    id: string;
    payrollPeriodId: string;
    computedAt: Date;
    engineVersion: string;
    ruleSetVersion: number | null;
    statutoryConfigId: string | null;
    ytdAnchorPayslipId: string | null;
    grossPence: number;
    taxPence: number;
    niPence: number;
    pensionPence: number;
    netPence: number;
    lines: unknown;
  }): ExpectedPaySnapshot {
    return { ...row };
  }

  return {
    async supersedeAndCreate(input) {
      return db.$transaction(async (tx) => {
        await tx.expectedPay.updateMany({
          where: { userId, payrollPeriodId: input.payrollPeriodId, current: true },
          data: { current: false },
        });
        const row = await tx.expectedPay.create({
          data: {
            userId,
            payrollPeriodId: input.payrollPeriodId,
            engineVersion: input.engineVersion,
            ruleSetVersion: input.ruleSetVersion,
            statutoryConfigId: input.statutoryConfigId,
            ytdAnchorPayslipId: input.ytdAnchorPayslipId,
            grossPence: input.grossPence,
            taxPence: input.taxPence,
            niPence: input.niPence,
            pensionPence: input.pensionPence,
            netPence: input.netPence,
            lines: input.lines as Prisma.InputJsonValue,
          },
        });
        return { id: row.id };
      });
    },

    async currentForPeriod(payrollPeriodId) {
      const row = await db.expectedPay.findFirst({
        where: { userId, payrollPeriodId, current: true },
      });
      return row ? toSnapshot(row) : null;
    },

    async historyForPeriod(payrollPeriodId) {
      const rows = await db.expectedPay.findMany({
        where: { userId, payrollPeriodId },
        orderBy: { computedAt: 'desc' },
      });
      return rows.map(toSnapshot);
    },
  };
}

export function createPrismaPayslipRepository(
  db: PrismaClient,
  tenant: TenantContext
): PayslipRepository {
  const { userId } = tenant;

  function toRecord(row: {
    id: string;
    employerId: string;
    contractId: string;
    payrollPeriodId: string | null;
    documentStorageKey: string | null;
    payDate: Date;
    grossPence: number;
    taxPence: number;
    niPence: number;
    pensionPence: number;
    netPence: number;
    ytd: unknown;
    lines: unknown;
  }): PayslipRecord {
    return { ...row, payDate: fromDbDate(row.payDate) };
  }

  return {
    async create(input) {
      const row = await db.payslip.create({
        data: {
          userId,
          employerId: input.employerId,
          contractId: input.contractId,
          payrollPeriodId: input.payrollPeriodId,
          sourceEmailId: input.sourceEmailId ?? null,
          documentStorageKey: input.documentStorageKey ?? null,
          payDate: toDbDate(input.payDate),
          grossPence: input.grossPence,
          taxPence: input.taxPence,
          niPence: input.niPence,
          pensionPence: input.pensionPence,
          netPence: input.netPence,
          ytd: (input.ytd ?? null) as Prisma.InputJsonValue,
          lines: input.lines ?? [],
        },
      });
      return toRecord(row);
    },

    async list() {
      const rows = await db.payslip.findMany({ where: { userId }, orderBy: { payDate: 'desc' } });
      return rows.map(toRecord);
    },

    async getById(id) {
      const row = await db.payslip.findFirst({ where: { id, userId } });
      return row ? toRecord(row) : null;
    },

    async forPeriod(payrollPeriodId) {
      const row = await db.payslip.findFirst({ where: { userId, payrollPeriodId } });
      return row ? toRecord(row) : null;
    },

    async aggregateBefore(employerId, payDate, taxYearStart) {
      const where = {
        userId,
        employerId,
        payDate: { gte: toDbDate(taxYearStart), lt: toDbDate(payDate) },
      };
      const [agg, latest] = await Promise.all([
        db.payslip.aggregate({
          where,
          _count: { id: true },
          _sum: { grossPence: true, taxPence: true },
        }),
        db.payslip.findFirst({ where, orderBy: { payDate: 'desc' } }),
      ]);
      return {
        count: agg._count.id,
        sumGrossPence: agg._sum.grossPence ?? 0,
        sumTaxPence: agg._sum.taxPence ?? 0,
        latestId: latest?.id ?? null,
        latestYtd: latest?.ytd ?? null,
      };
    },
  };
}

export function createPrismaDiscrepancyRepository(
  db: PrismaClient,
  tenant: TenantContext
): DiscrepancyRepository {
  const { userId } = tenant;

  function toRecord(row: {
    id: string;
    payrollPeriodId: string;
    payslipId: string | null;
    kind: string;
    severity: string;
    status: string;
    expectedPence: number | null;
    actualPence: number | null;
    deltaPence: number;
    summary: string;
    createdAt: Date;
  }): DiscrepancyRecord {
    return {
      ...row,
      severity: row.severity as DiscrepancyRecord['severity'],
      status: row.status as DiscrepancyRecord['status'],
    };
  }

  return {
    async replaceOpenForPeriod(payrollPeriodId, payslipId, drafts) {
      return db.$transaction(async (tx) => {
        await tx.discrepancy.deleteMany({
          where: { userId, payrollPeriodId, status: 'OPEN' },
        });
        const rows = [];
        for (const draft of drafts) {
          rows.push(
            await tx.discrepancy.create({
              data: {
                userId,
                payrollPeriodId,
                payslipId,
                kind: draft.kind as never,
                severity: draft.severity,
                expectedPence: draft.expectedPence,
                actualPence: draft.actualPence,
                deltaPence: draft.deltaPence,
                summary: draft.summary,
                evidence: draft.evidence as Prisma.InputJsonValue,
              },
            })
          );
        }
        return rows.map(toRecord);
      });
    },

    async list(filter) {
      const rows = await db.discrepancy.findMany({
        where: { userId, ...(filter?.status ? { status: filter.status } : {}) },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(toRecord);
    },

    async setStatus(id, status) {
      await db.discrepancy.updateMany({
        where: { id, userId },
        data: { status, resolvedAt: status === 'OPEN' ? null : new Date() },
      });
    },
  };
}

export function createPrismaTaxProfileRepository(
  db: PrismaClient,
  tenant: TenantContext
): TaxProfileRepository {
  const { userId } = tenant;
  return {
    async get(jurisdiction, taxYear) {
      const row = await db.taxProfile.findUnique({
        where: { userId_jurisdiction_taxYear: { userId, jurisdiction, taxYear } },
      });
      if (!row) return null;
      return {
        jurisdiction: row.jurisdiction,
        taxYear: row.taxYear,
        taxCode: row.taxCode,
        taxBasis: row.taxBasis,
        niCategory: row.niCategory,
        pension: row.pension,
        studentLoan: row.studentLoan,
      };
    },

    async upsert(input) {
      await db.taxProfile.upsert({
        where: {
          userId_jurisdiction_taxYear: {
            userId,
            jurisdiction: input.jurisdiction,
            taxYear: input.taxYear,
          },
        },
        create: {
          userId,
          jurisdiction: input.jurisdiction,
          taxYear: input.taxYear,
          taxCode: input.taxCode,
          taxBasis: input.taxBasis,
          niCategory: input.niCategory,
          pension: (input.pension ?? undefined) as Prisma.InputJsonValue,
          studentLoan: input.studentLoan,
        },
        update: {
          taxCode: input.taxCode,
          taxBasis: input.taxBasis,
          niCategory: input.niCategory,
          pension: (input.pension ?? undefined) as Prisma.InputJsonValue,
          studentLoan: input.studentLoan,
        },
      });
    },
  };
}
