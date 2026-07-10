import { Prisma, type PrismaClient } from '@prisma/client';
import type { TenantContext } from '@/server/tenant';
import type { EmailMessageRepository } from '../ports';

export function createPrismaEmailMessageRepository(
  db: PrismaClient,
  tenant: TenantContext
): EmailMessageRepository {
  const { userId } = tenant;

  return {
    async insertIfNew(input) {
      try {
        const row = await db.emailMessage.create({
          data: {
            userId,
            dedupeKey: input.dedupeKey,
            providerMessageId: input.providerMessageId ?? null,
            mailboxConnectionId: input.mailboxConnectionId ?? null,
            receivedAt: input.receivedAt,
            subject: input.subject,
            fromAddress: input.fromAddress,
            rawStorageKey: input.rawStorageKey ?? null,
            sizeBytes: input.sizeBytes ?? null,
          },
        });
        return { created: true, id: row.id };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const existing = await db.emailMessage.findFirst({
            where: { dedupeKey: input.dedupeKey, userId },
            select: { id: true },
          });
          if (existing) return { created: false, id: existing.id };
        }
        throw e;
      }
    },

    async getById(id) {
      const row = await db.emailMessage.findFirst({
        where: { id, userId },
        select: {
          id: true,
          dedupeKey: true,
          receivedAt: true,
          subject: true,
          fromAddress: true,
          parseStatus: true,
          classification: true,
        },
      });
      return row;
    },

    async setArchive(id, rawStorageKey, sizeBytes) {
      await db.emailMessage.updateMany({
        where: { id, userId },
        data: { rawStorageKey, sizeBytes },
      });
    },

    async setClassification(id, classification) {
      await db.emailMessage.updateMany({
        where: { id, userId },
        data: { classification: classification as never },
      });
    },

    async setParseOutcome(id, outcome) {
      await db.emailMessage.updateMany({
        where: { id, userId },
        data: {
          parseStatus: outcome.status,
          parserId: outcome.parserId ?? null,
          parserVersion: outcome.parserVersion ?? null,
          parseError: outcome.parseError ?? null,
          parsedAt: new Date(),
        },
      });
    },

    async listByStatus(status) {
      const rows = await db.emailMessage.findMany({
        where: { userId, parseStatus: status },
        orderBy: { receivedAt: 'desc' },
        select: {
          id: true,
          dedupeKey: true,
          receivedAt: true,
          subject: true,
          fromAddress: true,
          parseStatus: true,
        },
      });
      return rows;
    },

    async countByStatus(status) {
      return db.emailMessage.count({ where: { userId, parseStatus: status } });
    },
  };
}
