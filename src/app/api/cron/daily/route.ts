import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { env } from '@/lib/env';

/**
 * Daily housekeeping (§9/§16). Auth mode: CRON_SECRET bearer token (Vercel
 * sets `Authorization: Bearer $CRON_SECRET` on cron invocations).
 *  - keep-alive query (Supabase free pauses after 7 idle days)
 *  - forwarder-silence detection (connections quiet for >3 days)
 *  - quarantine depth surfaced as a health notification
 */
const SILENCE_THRESHOLD_MS = 3 * 24 * 3600 * 1000;

export async function GET(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get('authorization');
  if (!env.CRON_SECRET || authorization !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  await prisma.$queryRaw`SELECT 1`; // keep-alive

  const now = Date.now();
  const connections = await prisma.mailboxConnection.findMany({
    select: { id: true, userId: true, label: true, lastEventAt: true },
  });
  const silent = connections.filter(
    (c) => c.lastEventAt !== null && now - c.lastEventAt.getTime() > SILENCE_THRESHOLD_MS
  );

  for (const connection of silent) {
    const recent = await prisma.notification.findFirst({
      where: {
        userId: connection.userId,
        type: 'SYSTEM_HEALTH',
        createdAt: { gte: new Date(now - 24 * 3600 * 1000) },
      },
      select: { id: true },
    });
    if (!recent) {
      await prisma.notification.create({
        data: {
          userId: connection.userId,
          type: 'SYSTEM_HEALTH',
          payload: {
            kind: 'FORWARDER_SILENT',
            connectionId: connection.id,
            label: connection.label,
            lastEventAt: connection.lastEventAt?.toISOString() ?? null,
          },
        },
      });
    }
  }

  const quarantined = await prisma.emailMessage.count({ where: { parseStatus: 'QUARANTINED' } });

  return NextResponse.json({
    ok: true,
    keptAlive: true,
    connections: connections.length,
    silentConnections: silent.length,
    quarantined,
  });
}
