import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from '@/generated/prisma/client';
import { SUPABASE_PROD_CA_2021 } from '@/server/supabase-ca';

const UNCONFIGURED_DATABASE_URL = 'postgresql://shiftsync:shiftsync@127.0.0.1:5432/shiftsync';

/**
 * Supabase's Postgres endpoints use a certificate chain rooted in Supabase's
 * published private CA. Vercel's Node runtime supports supplying that CA to
 * node-postgres, allowing full certificate and hostname verification.
 *
 * pg-connection-string gives URL SSL parameters precedence over an explicit
 * `ssl` object, so remove them before attaching the trusted CA configuration.
 */
export function poolConfigForRuntime(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  const isSupabase =
    url.hostname === 'supabase.co' ||
    url.hostname.endsWith('.supabase.co') ||
    url.hostname.endsWith('.supabase.com');

  if (!isSupabase) {
    return { connectionString };
  }

  for (const key of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) {
    url.searchParams.delete(key);
  }

  return {
    connectionString: url.toString(),
    ssl: {
      ca: SUPABASE_PROD_CA_2021,
      rejectUnauthorized: true,
    },
  };
}

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  const adapter = new PrismaPg(poolConfigForRuntime(connectionString ?? UNCONFIGURED_DATABASE_URL));

  return new PrismaClient({ adapter });
}
