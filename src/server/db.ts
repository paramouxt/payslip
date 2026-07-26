import type { PrismaClient } from '@/generated/prisma/client';
import { createPrismaClient } from '@/server/prisma-client';

/**
 * Reuse one Prisma client per warm Node process. Vercel may keep a process
 * alive for multiple requests, so the singleton prevents needless pools
 * during development hot reloads and production function reuse.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
