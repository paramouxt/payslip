import type { Prisma, PrismaClient } from '@prisma/client';
import type { TenantContext } from '@/server/tenant';
import type { NotificationRepository } from '../ports';

export function createPrismaNotificationRepository(
  db: PrismaClient,
  tenant: TenantContext
): NotificationRepository {
  const { userId } = tenant;

  return {
    async create(input) {
      const row = await db.notification.create({
        data: {
          userId,
          type: input.type as Prisma.NotificationCreateInput['type'],
          payload: input.payload ?? {},
        },
      });
      return {
        id: row.id,
        type: row.type,
        payload: row.payload,
        createdAt: row.createdAt,
        readAt: row.readAt,
      };
    },

    async listUnread() {
      const rows = await db.notification.findMany({
        where: { userId, readAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        payload: row.payload,
        createdAt: row.createdAt,
        readAt: row.readAt,
      }));
    },

    async markRead(id) {
      await db.notification.updateMany({
        where: { id, userId, readAt: null },
        data: { readAt: new Date() },
      });
    },
  };
}
