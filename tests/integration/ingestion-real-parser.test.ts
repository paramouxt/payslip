import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { buildDefaultParserRegistry } from '@/core/parsing/registry';
import { isoDate } from '@/core/dates/iso-date';
import { createMemoryStorage } from '@/server/integrations/storage/object-storage';
import { noopRealtimePublisher } from '@/server/integrations/realtime/publisher';
import { createIngestionService } from '@/server/services/ingestion-service';
import { createMailboxService } from '@/server/services/mailbox-service';
import { createTenantRepositories, type TenantRepositories } from '@/server/repositories';
import { deriveIngestionKey, hmacSha256Hex } from '@/server/security/crypto';
import { buildTracsisEmployerTemplate } from '@/server/templates/tracsis';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('ingestion with real tracsis parser (Postgres)', () => {
  let db: PrismaClient;
  let repos: TenantRepositories;
  let storage: ReturnType<typeof createMemoryStorage>;
  let connectionId: string;
  let userId: string;

  function signedPush(payload: object) {
    const rawBody = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000);
    const key = deriveIngestionKey(connectionId, 1);
    return {
      headers: {
        'x-shiftsync-timestamp': ts.toString(),
        'x-shiftsync-signature': hmacSha256Hex(key, `${ts.toString()}.${rawBody}`),
      },
      rawBody,
      receivedAt: new Date(),
    };
  }

  function pushPayload(messageId: string, subject: string, plaintextBody: string) {
    return {
      connectionId,
      message: {
        providerMessageId: messageId,
        receivedAt: new Date().toISOString(),
        subject,
        fromAddress: 'eventjobs@tracsis.com',
        plaintextBody,
        attachments: [],
      },
    };
  }

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    storage = createMemoryStorage();
    const user = await db.user.create({
      data: { email: `ingest-real-${randomUUID()}@test.local` },
    });
    userId = user.id;
    repos = createTenantRepositories(db, { userId });
    const template = buildTracsisEmployerTemplate();
    template.rosterNames = ['Divya', 'Divya Patel'];
    const { employerId } = await repos.employers.createFromConfig(template);
    await repos.contracts.create({ employerId, startDate: isoDate('2026-04-06') });
    const mailbox = createMailboxService(repos);
    const connection = await mailbox.createAppsScriptConnection({ label: 'Test Gmail' });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('creates then amends an existing shift without duplication', async () => {
    const service = createIngestionService({
      db,
      storage,
      realtime: noopRealtimePublisher,
      registry: buildDefaultParserRegistry(),
    });

    const first = await service.receivePush(
      signedPush(
        pushPayload(
          `m-${randomUUID()}`,
          'Confirmation of Work — Reserved Parking',
          ['Reference: JOB-9001', '05/07/2026 09:00 - 18:00 9 hours', 'Total Hours: 9'].join('\n')
        )
      )
    );
    expect(first).toMatchObject({ status: 'ACCEPTED', parseStatus: 'PARSED' });

    const second = await service.receivePush(
      signedPush(
        pushPayload(
          `m-${randomUUID()}`,
          'Confirmation of Work — Reserved Parking',
          ['Reference: JOB-9001', '05/07/2026 09:00 - 17:00 8 hours', 'Total Hours: 8'].join('\n')
        )
      )
    );
    expect(second).toMatchObject({ status: 'ACCEPTED', parseStatus: 'PARSED' });

    const shifts = await repos.shifts.listBetween(isoDate('2026-07-05'), isoDate('2026-07-05'));
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.snapshot.endAt.toISOString()).toContain('17:00:00.000Z');
    expect(shifts[0]!.snapshot.roleId).not.toBeNull();

    const history = await repos.shifts.getWithHistory(shifts[0]!.id);
    expect(history?.events.map((e) => e.kind)).toEqual(['CREATED', 'AMENDED']);
  });
});
