import type { PrismaClient } from '@/generated/prisma/client';
import type { TenantContext } from '@/server/tenant';
import type {
  IngestConnectionLookup,
  MailboxConnectionRecord,
  MailboxConnectionRepository,
} from '../ports';

interface ConnectionRow {
  id: string;
  provider: string;
  label: string;
  emailAddress: string | null;
  lastEventAt: Date | null;
  createdAt: Date;
  secrets: { keyVersion: number; revokedAt: Date | null }[];
}

function toRecord(row: ConnectionRow): MailboxConnectionRecord {
  const active = row.secrets.find((s) => s.revokedAt === null);
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    emailAddress: row.emailAddress,
    lastEventAt: row.lastEventAt,
    activeKeyVersion: active?.keyVersion ?? 0,
    createdAt: row.createdAt,
  };
}

const secretsInclude = {
  secrets: {
    orderBy: { keyVersion: 'desc' as const },
    select: { keyVersion: true, revokedAt: true },
  },
};

export function createPrismaMailboxConnectionRepository(
  db: PrismaClient,
  tenant: TenantContext
): MailboxConnectionRepository {
  const { userId } = tenant;
  return {
    async create(input) {
      const row = await db.mailboxConnection.create({
        data: {
          userId,
          provider: input.provider,
          label: input.label,
          emailAddress: input.emailAddress ?? null,
          secrets: {
            create: { keyVersion: input.keyVersion, secretHash: input.verificationHash },
          },
        },
        include: secretsInclude,
      });
      return toRecord(row);
    },

    async list() {
      const rows = await db.mailboxConnection.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        include: secretsInclude,
      });
      return rows.map(toRecord);
    },

    async getById(id) {
      const row = await db.mailboxConnection.findFirst({
        where: { id, userId },
        include: secretsInclude,
      });
      return row ? toRecord(row) : null;
    },

    async rotateKey(connectionId, keyVersion, verificationHash) {
      await db.$transaction(async (tx) => {
        const owned = await tx.mailboxConnection.findFirst({
          where: { id: connectionId, userId },
          select: { id: true },
        });
        if (!owned) throw new Error('connection not found for tenant');
        await tx.ingestionSecret.updateMany({
          where: { mailboxConnectionId: connectionId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.ingestionSecret.create({
          data: { mailboxConnectionId: connectionId, keyVersion, secretHash: verificationHash },
        });
      });
    },

    async touchLastEvent(connectionId, at) {
      await db.mailboxConnection.updateMany({
        where: { id: connectionId, userId },
        data: { lastEventAt: at },
      });
    },
  };
}

export function createPrismaIngestConnectionLookup(db: PrismaClient): IngestConnectionLookup {
  return {
    async findForIngest(connectionId) {
      const row = await db.mailboxConnection.findUnique({
        where: { id: connectionId },
        include: {
          secrets: {
            where: { revokedAt: null },
            orderBy: { keyVersion: 'desc' },
            take: 1,
            select: { keyVersion: true, secretHash: true },
          },
        },
      });
      const active = row?.secrets[0];
      if (!row || !active) return null;
      return {
        id: row.id,
        userId: row.userId,
        activeKeyVersion: active.keyVersion,
        verificationHash: active.secretHash,
      };
    },
  };
}
