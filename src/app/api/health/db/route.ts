import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { env } from '@/lib/env';
import { prisma } from '@/server/db';
import { connectionStringForRuntime } from '@/server/prisma-client';

interface PgSslStatus {
  ssl: boolean;
}

interface ProbeResult {
  ok: boolean;
  elapsedMs: number;
  ssl?: boolean;
  error?: {
    name: string;
    code?: string;
    message: string;
  };
}

function safeError(error: unknown): ProbeResult['error'] {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', message: 'Unknown database error' };
  }

  const code =
    'code' in error && typeof error.code === 'string' ? error.code : undefined;
  const message = error.message
    .replace(/postgres(?:ql)?:\/\/\S+/giu, '[redacted-database-url]')
    .slice(0, 300);

  return { name: error.name, ...(code ? { code } : {}), message };
}

function connectionSummary(connectionString: string | undefined) {
  if (!connectionString) {
    return { configured: false };
  }

  try {
    const url = new URL(connectionString);
    return {
      configured: true,
      validUrl: true,
      poolerHost: url.hostname.endsWith('.pooler.supabase.com'),
      port: url.port || '5432',
      transactionPooler: url.port === '6543',
      projectScopedUser: decodeURIComponent(url.username).startsWith('postgres.'),
      passwordPresent: url.password.length > 0,
      passwordLooksPlaceholder: /YOUR-PASSWORD|\[[^\]]*PASSWORD[^\]]*\]/iu.test(
        decodeURIComponent(url.password)
      ),
      sslmode: url.searchParams.get('sslmode') ?? 'runtime-default',
    };
  } catch {
    return { configured: true, validUrl: false };
  }
}

async function rawPgProbe(connectionString: string): Promise<ProbeResult> {
  const startedAt = Date.now();
  const client = new Client({
    connectionString: connectionStringForRuntime(connectionString),
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    const result = await client.query<PgSslStatus>(
      'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()'
    );
    return {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ssl: result.rows[0]?.ssl === true,
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: safeError(error),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function prismaProbe(): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const rows = await prisma.$queryRaw<PgSslStatus[]>`
      SELECT ssl
      FROM pg_stat_ssl
      WHERE pid = pg_backend_pid()
    `;
    return {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ssl: rows[0]?.ssl === true,
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: safeError(error),
    };
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get('authorization');
  const diagnosticSecret = process.env.DB_DIAGNOSTIC_SECRET;
  const authorized = [env.CRON_SECRET, diagnosticSecret].some(
    (secret) => typeof secret === 'string' && authorization === `Bearer ${secret}`
  );

  if (!authorized) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json(
      {
        ok: false,
        config: connectionSummary(connectionString),
        error: { code: 'DATABASE_URL_MISSING' },
      },
      { status: 503 }
    );
  }

  const rawPg = await rawPgProbe(connectionString);
  const prismaResult: ProbeResult = rawPg.ok
    ? await prismaProbe()
    : {
        ok: false,
        elapsedMs: 0,
        error: { name: 'Skipped', message: 'Raw pg probe failed' },
      };

  const ok = rawPg.ok && prismaResult.ok;
  return NextResponse.json(
    {
      ok,
      config: connectionSummary(connectionString),
      rawPg,
      prisma: prismaResult,
    },
    { status: ok ? 200 : 503 }
  );
}
