import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

// Prisma's JavaScript engine requires a driver adapter. The fallback URL lets
// build-time imports initialise without opening a connection; any real query
// still fails clearly until DATABASE_URL is configured in the runtime.
const UNCONFIGURED_DATABASE_URL =
  'postgresql://shiftsync:shiftsync@127.0.0.1:5432/shiftsync';

/**
 * Cloudflare terminates TLS through `cloudflare:sockets`, which always
 * verifies the certificate and ignores `rejectUnauthorized:false`. Supabase
 * enforces SSL on its pooler and presents a publicly-trusted certificate, so
 * the Worker must negotiate TLS or the server closes the socket. `pg` decides
 * that from the URL's `sslmode`, so pin it when the operator has not stated
 * one; an explicit `sslmode` is honoured (and fails loudly if wrong) rather
 * than silently overridden.
 */
function connectionStringForRuntime(connectionString: string): string {
  if (typeof navigator === 'undefined' || navigator.userAgent !== 'Cloudflare-Workers') {
    return connectionString;
  }

  const url = new URL(connectionString);
  if (!url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'require');
  }
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
