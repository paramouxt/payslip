import type { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@/server/tenant';
import type { PayrollPeriodRecord, PayrollPeriodRepository } from '../ports';
import { assertEmployerOwned } from './employer-repository';
import { fromDbDate, toDbDate } from './mappers';

interface PeriodRow {
  id: string;
  employerId: string;
  sequence: number;
  startDate: Date;
  endDate: Date;
  expectedPayDate: Date;
}

function toRecord(row: PeriodRow): PayrollPeriodRecord {
  return {
    id: row.id,
    employerId: row.employerId,
    sequence: row.sequence,
    startDate: fromDbDate(row.startDate),
    endDate: fromDbDate(row.endDate),
    expectedPayDate: fromDbDate(row.expectedPayDate),
  };
}

export function createPrismaPayrollPeriodRepository(
  db: PrismaClient,
  tenant: TenantContext
): PayrollPeriodRepository {
  const { userId } = tenant;

  return {
    async ensure(employerId, span) {
      await assertEmployerOwned(db, tenant, employerId);
      const row = await db.payrollPeriod.upsert({
        where: { employerId_sequence: { employerId, sequence: span.sequence } },
        create: {
          userId,
          employerId,
          sequence: span.sequence,
          startDate: toDbDate(span.startDate),
          endDate: toDbDate(span.endDate),
          expectedPayDate: toDbDate(span.payDate),
        },
        update: {},
      });
      return toRecord(row);
    },

    async listRange(employerId, from, to) {
      const rows = await db.payrollPeriod.findMany({
        where: {
          userId,
          employerId,
          endDate: { gte: toDbDate(from) },
          startDate: { lte: toDbDate(to) },
        },
        orderBy: { sequence: 'asc' },
      });
      return rows.map(toRecord);
    },
  };
}
