import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { prisma } from '@/server/db';

interface PgSslStatus {
  ssl: boolean;
}

export async function GET(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get('authorization');
  if (!env.CRON_SECRET || authorization !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  try {
    const rows = await prisma.$queryRaw<PgSslStatus[]>`
      SELECT ssl
      FROM pg_stat_ssl
      WHERE pid = pg_backend_pid()
    `;

    return NextResponse.json({
      ok: true,
      ssl: rows[0]?.ssl === true,
    });
  } catch (error) {
    console.error('Database health check failed', error);
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'DATABASE_UNAVAILABLE' },
      },
      { status: 503 }
    );
  }
}
