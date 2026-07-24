import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

// Prisma's JavaScript engine requires a driver adapter. The fallback URL lets
// build-time imports initialise without opening a connection; any real query
// still fails clearly until DATABASE_URL is configured in the runtime.
const UNCONFIGURED_DATABASE_URL =
  'postgresql://shiftsync:shiftsync@127.0.0.1:5432/shiftsync';

function connectionStringForRuntime(connectionString: string): string {
  if (
    typeof navigator === 'undefined' ||
    navigator.userAgent !== 'Cloudflare-Workers'
  ) {
    return connectionString;
  }

  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'require');
  return url.toString();
}

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: connectionStringForRuntime(
      connectionString ?? UNCONFIGURED_DATABASE_URL
    ),
  });

  return new PrismaClient({ adapter });
}
