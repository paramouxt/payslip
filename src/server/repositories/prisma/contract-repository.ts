import type { PrismaClient } from '@/generated/prisma/client';
import type { TenantContext } from '@/server/tenant';
import type { ContractRecord, ContractRepository } from '../ports';
import { assertEmployerOwned } from './employer-repository';
import { fromDbDate, toDbDate } from './mappers';

interface ContractRow {
  id: string;
  employerId: string;
  startDate: Date;
  endDate: Date | null;
  defaultRoleId: string | null;
  notes: string | null;
}

function toRecord(row: ContractRow): ContractRecord {
  return {
    id: row.id,
    employerId: row.employerId,
    startDate: fromDbDate(row.startDate),
    endDate: row.endDate ? fromDbDate(row.endDate) : null,
    defaultRoleId: row.defaultRoleId,
    notes: row.notes,
  };
}

export function createPrismaContractRepository(
  db: PrismaClient,
  tenant: TenantContext
): ContractRepository {
  const { userId } = tenant;

  return {
    async create(input) {
      await assertEmployerOwned(db, tenant, input.employerId);
      const row = await db.contract.create({
        data: {
          userId,
          employerId: input.employerId,
          startDate: toDbDate(input.startDate),
          endDate: input.endDate ? toDbDate(input.endDate) : null,
          defaultRoleId: input.defaultRoleId ?? null,
          notes: input.notes ?? null,
        },
      });
      return toRecord(row);
    },

    async getById(id) {
      const row = await db.contract.findFirst({ where: { id, userId } });
      return row ? toRecord(row) : null;
    },

    async listByEmployer(employerId) {
      const rows = await db.contract.findMany({
        where: { userId, employerId },
        orderBy: { startDate: 'asc' },
      });
      return rows.map(toRecord);
    },
  };
}
