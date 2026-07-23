import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '@/server/prisma-client';

/**
 * Application-wide Prisma client. Serverless-safe singleton: module scope
 * survives warm invocations; the global stash prevents hot-reload leaks in
 * dev. Repositories take the client as a dependency — tests inject their own.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
