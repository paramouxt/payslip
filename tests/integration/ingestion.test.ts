import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ParserRegistry } from '@/core/parsing/registry';
import type { RotaParser } from '@/core/parsing/types';
import { isoDate } from '@/core/dates/iso-date';
import { createMemoryStorage } from '@/server/integrations/storage/object-storage';
import { noopRealtimePublisher } from '@/server/integrations/realtime/publisher';
import { createIngestionService } from '@/server/services/ingestion-service';
import { createMailboxService } from '@/server/services/mailbox-service';
import { createTenantRepositories, type TenantRepositories } from '@/server/repositories';
import { deriveIngestionKey, hmacSha256Hex } from '@/server/security/crypto';
import { buildTracsisEmployerTemplate } from '@/server/templates/tracsis';

const url = process.env.TEST_DATABASE_URL;

/** End-to-end pipeline against real Postgres + in-memory storage. */
describe.skipIf(!url)('ingestion pipeline (Postgres)', () => {
  let db: PrismaClient;
  let repos: TenantRepositories;
  let storage: ReturnType<typeof createMemoryStorage>;
  let connectionId: string;
  let userId: string;

  /** A parser that trusts a JSON body — stands in for a real fixture parser. */
  const fakeParser: RotaParser = {
    id: 'fake-rota',
    version: '1.0.0',
    employerSlug: 'tracsis-events',
    parse(input) {
      if (!input.plaintextBody) return { ok: false, reason: 'EMPTY' };
      try {
        const body = JSON.parse(input.plaintextBody) as { shifts?: unknown[] };
        if (!Array.isArray(body.shifts)) return { ok: false, reason: 'NO_SHIFTS' };
        return {
          ok: true,
          confidence: 1,
          shifts: body.shifts as never,
        };
      } catch {
        return { ok: false, reason: 'UNPARSEABLE' };
      }
    },
  };

  function makeService() {
    const registry = new ParserRegistry();
    registry.register(fakeParser);
    return createIngestionService({
      db,
      storage,
      realtime: noopRealtimePublisher,
      registry,
    });
  }

  function signedPush(payload: object, options?: { badSignature?: boolean; staleTs?: boolean }) {
    const rawBody = JSON.stringify(payload);
    const ts = options?.staleTs
      ? Math.floor(Date.now() / 1000) - 4000
      : Math.floor(Date.now() / 1000);
    const key = deriveIngestionKey(connectionId, 1);
    const signature = options?.badSignature
      ? 'deadbeef'.repeat(8)
      : hmacSha256Hex(key, `${ts.toString()}.${rawBody}`);
    return {
      headers: {
        'x-shiftsync-timestamp': ts.toString(),
        'x-shiftsync-signature': signature,
      },
      rawBody,
      receivedAt: new Date(),
    };
  }

  function pushPayload(messageId: string, subject: string, plaintextBody: string | null) {
    return {
      connectionId,
      message: {
        providerMessageId: messageId,
        receivedAt: new Date().toISOString(),
        subject,
        fromAddress: 'rota@tracsis.com',
        plaintextBody,
        attachments: [],
      },
    };
  }

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    storage = createMemoryStorage();
    const user = await db.user.create({
      data: { email: `ingest-${randomUUID()}@test.local` },
    });
    userId = user.id;
    repos = createTenantRepositories(db, { userId });
    const { employerId } = await repos.employers.createFromConfig(buildTracsisEmployerTemplate());
    await repos.contracts.create({ employerId, startDate: isoDate('2026-04-06') });
    const mailbox = createMailboxService(repos);
    const connection = await mailbox.createAppsScriptConnection({ label: 'Test Gmail' });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('rejects bad signatures and stale timestamps', async () => {
    const service = makeService();
    const bad = await service.receivePush(
      signedPush(pushPayload(`m-${randomUUID()}`, 'Rota', null), { badSignature: true })
    );
    expect(bad).toMatchObject({ status: 'REJECTED', httpStatus: 401 });
    const stale = await service.receivePush(
      signedPush(pushPayload(`m-${randomUUID()}`, 'Rota', null), { staleTs: true })
    );
    expect(stale).toMatchObject({ status: 'REJECTED', reason: 'STALE_TIMESTAMP' });
  });

  it('archives, classifies, parses, and creates evidence-carrying shifts', async () => {
    const service = makeService();
    const body = JSON.stringify({
      shifts: [
        {
          externalRef: 'TRX-777',
          date: '2026-06-21',
          startTime: '08:00',
          endTime: '18:00',
          roleSlug: 'hands-free',
          venue: 'Bicester Village',
          notes: null,
        },
      ],
    });
    const result = await service.receivePush(
      signedPush(pushPayload(`m-${randomUUID()}`, 'Rota w/c 21 June', body))
    );
    expect(result).toMatchObject({
      status: 'ACCEPTED',
      classification: 'ROTA',
      parseStatus: 'PARSED',
    });

    // Raw archived before interpretation.
    expect(storage.keys().some((k) => k.startsWith(`raw-email/${userId}/`))).toBe(true);

    // Shift exists with the email as evidence.
    const shifts = await repos.shifts.listBetween(isoDate('2026-06-21'), isoDate('2026-06-21'));
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.snapshot.externalRef).toBe('TRX-777');
    const history = await repos.shifts.getWithHistory(shifts[0]!.id);
    expect(history!.events[0]!.sourceEmailId).not.toBeNull();

    // Payroll period materialised for the shift's date (Tracsis seq 5).
    const periods = await repos.payrollPeriods.listRange(
      shifts[0]!.employerId,
      isoDate('2026-06-01'),
      isoDate('2026-07-01')
    );
    expect(periods.some((p) => p.startDate <= '2026-06-21' && p.endDate >= '2026-06-21')).toBe(
      true
    );

    // Notification raised.
    const unread = await repos.notifications.listUnread();
    expect(unread.some((n) => n.type === 'ROTA_INGESTED')).toBe(true);
  });

  it('is idempotent: the same providerMessageId lands exactly once', async () => {
    const service = makeService();
    const messageId = `m-${randomUUID()}`;
    const payload = pushPayload(messageId, 'Rota duplicate test', null);
    const first = await service.receivePush(signedPush(payload));
    const second = await service.receivePush(signedPush(payload));
    expect(first.status).toBe('ACCEPTED');
    expect(second.status).toBe('DUPLICATE');
  });

  it('quarantines what it cannot parse — never guesses', async () => {
    const service = makeService();
    const result = await service.receivePush(
      signedPush(pushPayload(`m-${randomUUID()}`, 'Rota amendment', 'Dear all, see attached…'))
    );
    expect(result).toMatchObject({ status: 'ACCEPTED', parseStatus: 'QUARANTINED' });
    const quarantined = await repos.emailMessages.listByStatus('QUARANTINED');
    expect(quarantined.length).toBeGreaterThan(0);
  });

  it('ignores unmatched senders without noise', async () => {
    const service = makeService();
    const raw = JSON.stringify({
      connectionId,
      message: {
        providerMessageId: `m-${randomUUID()}`,
        receivedAt: new Date().toISOString(),
        subject: 'You won a prize',
        fromAddress: 'spam@example.com',
        attachments: [],
      },
    });
    const ts = Math.floor(Date.now() / 1000).toString();
    const key = deriveIngestionKey(connectionId, 1);
    const result = await service.receivePush({
      headers: {
        'x-shiftsync-timestamp': ts,
        'x-shiftsync-signature': hmacSha256Hex(key, `${ts}.${raw}`),
      },
      rawBody: raw,
      receivedAt: new Date(),
    });
    expect(result).toMatchObject({
      status: 'ACCEPTED',
      classification: 'OTHER',
      parseStatus: 'IGNORED',
    });
  });

  it('key rotation invalidates old signatures', async () => {
    const service = makeService();
    const mailbox = createMailboxService(repos);
    const connection = await mailbox.createAppsScriptConnection({ label: 'Rotation test' });
    const oldKey = deriveIngestionKey(connection.id, 1);
    await mailbox.rotate(connection.id);

    const raw = JSON.stringify({
      connectionId: connection.id,
      message: {
        providerMessageId: `m-${randomUUID()}`,
        receivedAt: new Date().toISOString(),
        subject: 'Rota',
        fromAddress: 'rota@tracsis.com',
        attachments: [],
      },
    });
    const ts = Math.floor(Date.now() / 1000).toString();
    const result = await service.receivePush({
      headers: {
        'x-shiftsync-timestamp': ts,
        'x-shiftsync-signature': hmacSha256Hex(oldKey, `${ts}.${raw}`),
      },
      rawBody: raw,
      receivedAt: new Date(),
    });
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'BAD_SIGNATURE' });
  });
});
