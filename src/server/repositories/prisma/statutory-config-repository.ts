import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { StatutoryConfigRepository } from '../ports';
import { fromDbDate, toDbDate } from './mappers';

/** Global reference data — deliberately not tenant-scoped. */
export function createPrismaStatutoryConfigRepository(db: PrismaClient): StatutoryConfigRepository {
  return {
    async get(jurisdiction, taxYear) {
      const row = await db.statutoryConfig.findUnique({
        where: { jurisdiction_taxYear: { jurisdiction, taxYear } },
      });
      if (!row) return null;
      return {
        id: row.id,
        effectiveFrom: fromDbDate(row.effectiveFrom),
        config: row.config,
        source: row.source,
      };
    },

    async upsert(input) {
      const row = await db.statutoryConfig.upsert({
        where: {
          jurisdiction_taxYear: { jurisdiction: input.jurisdiction, taxYear: input.taxYear },
        },
        create: {
          jurisdiction: input.jurisdiction,
          taxYear: input.taxYear,
          effectiveFrom: toDbDate(input.effectiveFrom),
          config: input.config as Prisma.InputJsonValue,
          source: input.source,
        },
        update: {
          effectiveFrom: toDbDate(input.effectiveFrom),
          config: input.config as Prisma.InputJsonValue,
          source: input.source,
        },
      });
      return { id: row.id };
    },
  };
}
