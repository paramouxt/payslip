// Dev tool: creates (or reuses) a mailbox connection and fires a signed push
// at a running dev server, exactly as the Apps Script forwarder would.
// Usage: APP_URL=http://localhost:3101 pnpm exec tsx --tsconfig tsconfig.json scripts/dev/e2e-ingest.ts
import { PrismaClient } from '@prisma/client';
import { createTenantRepositories } from '@/server/repositories';
import { createMailboxService } from '@/server/services/mailbox-service';
import { buildTracsisEmployerTemplate } from '@/server/templates/tracsis';
import { deriveIngestionKey, hmacSha256Hex } from '@/server/security/crypto';
import { isoDate } from '@/core/dates/iso-date';

async function main() {
  const db = new PrismaClient();
  const email = 'piyushjainsanjay@gmail.com';
  const user = await db.user.upsert({ where: { email }, create: { email }, update: {} });
  const repos = createTenantRepositories(db, { userId: user.id });
  let employers = await repos.employers.list();
  if (employers.length === 0) {
    await repos.employers.createFromConfig(buildTracsisEmployerTemplate());
    employers = await repos.employers.list();
  }
  const contracts = await repos.contracts.listByEmployer(employers[0]!.id);
  if (contracts.length === 0) {
    await repos.contracts.create({
      employerId: employers[0]!.id,
      startDate: isoDate('2026-04-06'),
    });
  }
  const mailbox = createMailboxService(repos);
  const connections = await repos.mailboxConnections.list();
  const connection = connections[0] ?? (await mailbox.createAppsScriptConnection({ label: 'E2E' }));
  const body = JSON.stringify({
    connectionId: connection.id,
    message: {
      providerMessageId: 'e2e-' + Date.now().toString(),
      receivedAt: new Date().toISOString(),
      subject: 'Rota w/c 20 July',
      fromAddress: 'rota@tracsis.com',
      plaintextBody: 'Your shifts for next week are attached.',
      attachments: [],
    },
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const key = deriveIngestionKey(connection.id, connection.activeKeyVersion || 1);
  const sig = hmacSha256Hex(key, ts + '.' + body);
  const res = await fetch((process.env.APP_URL ?? 'http://localhost:3000') + '/api/ingest/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shiftsync-timestamp': ts,
      'x-shiftsync-signature': sig,
    },
    body,
  });
  console.log('HTTP', res.status, JSON.stringify(await res.json()));
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
