import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { PushRequest } from '@/core/ingestion/provider';
import { classifyEmail } from '@/core/parsing/classifier';
import type { ParserRegistry } from '@/core/parsing/registry';
import type { CandidateShift, EmailClassificationKind } from '@/core/parsing/types';
import { senderPatternSchema } from '@/core/domain/employer/employer-config';
import { instantFromZoned } from '@/core/dates/zoned';
import { addDays, compareIsoDates } from '@/core/dates/iso-date';
import { resolvePeriodFor } from '@/core/domain/payroll-period/scheme';
import { Shift } from '@/core/domain/shift/shift';
import { appsScriptPushProvider } from '@/server/integrations/mailbox/apps-script-push';
import type { ObjectStorage } from '@/server/integrations/storage/object-storage';
import type { RealtimePublisher } from '@/server/integrations/realtime/publisher';
import {
  createGlobalRepositories,
  createTenantRepositories,
  type TenantRepositories,
} from '@/server/repositories';
import {
  deriveIngestionKey,
  hmacSha256Hex,
  ingestionKeyVerificationHash,
  safeEqualHex,
} from '@/server/security/crypto';
import { notifyUser } from '@/server/services/notification-service';

/**
 * The ingestion pipeline (constitution §11): verify → dedupe → archive raw →
 * classify → parse → apply domain events → recompute → notify → broadcast.
 * Idempotent at every stage; failures park mail in quarantine, never drop it.
 *
 * `PayrollProjector` is the Phase 8 seam: after roster changes, affected
 * periods are recomputed. Phase 7 wires a no-op.
 */
export interface PayrollProjector {
  recomputePeriodsTouching(
    tenantUserId: string,
    employerId: string,
    dates: string[]
  ): Promise<void>;
}

export const noopPayrollProjector: PayrollProjector = {
  recomputePeriodsTouching: () => Promise.resolve(),
};

export type IngestResult =
  | { status: 'REJECTED'; httpStatus: number; reason: string }
  | { status: 'DUPLICATE'; emailId: string }
  | { status: 'ACCEPTED'; emailId: string; parseStatus: string; classification: string };

export interface IngestionServiceDeps {
  db: PrismaClient;
  storage: ObjectStorage;
  realtime: RealtimePublisher;
  registry: ParserRegistry;
  projector?: PayrollProjector;
}

export function createIngestionService(deps: IngestionServiceDeps) {
  const { db, storage, realtime, registry } = deps;
  const projector = deps.projector ?? noopPayrollProjector;
  const globals = createGlobalRepositories(db);

  async function verify(request: PushRequest) {
    return appsScriptPushProvider.parseAndVerify(request, {
      async verify({ mailboxConnectionId, signature, signedPayload }) {
        const connection = await globals.ingestConnections.findForIngest(mailboxConnectionId);
        if (!connection) return false;
        const key = deriveIngestionKey(connection.id, connection.activeKeyVersion);
        if (ingestionKeyVerificationHash(key) !== connection.verificationHash) return false;
        return safeEqualHex(hmacSha256Hex(key, signedPayload), signature);
      },
    });
  }

  async function applyRotaCandidates(
    repos: TenantRepositories,
    input: {
      userId: string;
      employerId: string;
      timezone: string;
      contractId: string;
      emailId: string;
      receivedAt: Date;
      candidates: CandidateShift[];
    }
  ): Promise<{ created: number; ambiguous: number }> {
    let created = 0;
    let ambiguous = 0;
    for (const candidate of input.candidates) {
      const startAt = instantFromZoned(candidate.date, candidate.startTime, input.timezone);
      let endDate = candidate.date;
      if (candidate.endTime <= candidate.startTime) endDate = addDays(candidate.date, 1);
      const endAt = instantFromZoned(endDate, candidate.endTime, input.timezone);

      // Matching (v1): externalRef, else exact (date, startAt) on the contract.
      // Anything fuzzier is Phase 7.1 with real corpora; ambiguity quarantines.
      const sameDay = await repos.shifts.listBetween(candidate.date, candidate.date, {
        employerId: input.employerId,
      });
      const match = sameDay.find((s) => {
        const byRef = candidate.externalRef
          ? s.snapshot.externalRef === candidate.externalRef
          : false;
        return byRef || s.snapshot.startAt.getTime() === startAt.getTime();
      });
      if (match) {
        ambiguous += 1; // update/diff flow needs fixtures; do not guess (§11)
        continue;
      }
      const { shift, event } = Shift.create({
        identity: {
          id: crypto.randomUUID(),
          userId: input.userId,
          employerId: input.employerId,
          contractId: input.contractId,
        },
        details: {
          externalRef: candidate.externalRef,
          date: candidate.date,
          startAt,
          endAt,
          timezone: input.timezone,
          roleId: null,
          venue: candidate.venue,
          notes: candidate.notes,
        },
        evidence: { sourceEmailId: input.emailId, occurredAt: input.receivedAt },
      });
      await repos.shifts.create(shift, event);
      created += 1;
    }
    return { created, ambiguous };
  }

  return {
    async receivePush(request: PushRequest): Promise<IngestResult> {
      const verification = await verify(request);
      if (!verification.ok) {
        const httpStatus =
          verification.reason === 'MALFORMED'
            ? 400
            : verification.reason === 'STALE_TIMESTAMP'
              ? 408
              : 401;
        return { status: 'REJECTED', httpStatus, reason: verification.reason };
      }

      const connection = await globals.ingestConnections.findForIngest(
        verification.mailboxConnectionId
      );
      if (!connection) return { status: 'REJECTED', httpStatus: 401, reason: 'UNKNOWN_CONNECTION' };

      const tenant = { userId: connection.userId };
      const repos = createTenantRepositories(db, tenant);
      const email = verification.email;

      const run = await db.ingestionRun.create({
        data: { userId: tenant.userId, trigger: 'PUSH' },
      });

      const dedupeKey = createHash('sha256')
        .update(`${tenant.userId}:${email.providerMessageId}`)
        .digest('hex');
      const inserted = await repos.emailMessages.insertIfNew({
        dedupeKey,
        providerMessageId: email.providerMessageId,
        mailboxConnectionId: connection.id,
        receivedAt: email.receivedAt,
        subject: email.subject,
        fromAddress: email.fromAddress,
      });
      if (!inserted.created) {
        await db.ingestionRun.update({
          where: { id: run.id },
          data: { finishedAt: new Date(), stats: { duplicate: true, emailId: inserted.id } },
        });
        return { status: 'DUPLICATE', emailId: inserted.id };
      }
      const emailId = inserted.id;

      // Archive BEFORE interpretation (§11): raw MIME when supplied, else a
      // faithful JSON envelope of everything the provider gave us.
      const metadata = (email.metadata ?? {}) as {
        plaintextBody?: string | null;
        htmlBody?: string | null;
      };
      const rawBuffer = email.rawMimeBase64
        ? Buffer.from(email.rawMimeBase64, 'base64')
        : Buffer.from(
            JSON.stringify({
              subject: email.subject,
              fromAddress: email.fromAddress,
              receivedAt: email.receivedAt.toISOString(),
              plaintextBody: metadata.plaintextBody ?? null,
              htmlBody: metadata.htmlBody ?? null,
              attachments: (email.attachments ?? []).map((a) => a.filename),
            })
          );
      const rawKey = `raw-email/${tenant.userId}/${emailId}${email.rawMimeBase64 ? '.eml' : '.json'}`;
      await storage.put(
        rawKey,
        rawBuffer,
        email.rawMimeBase64 ? 'message/rfc822' : 'application/json'
      );
      let archivedBytes = rawBuffer.byteLength;
      for (const [i, att] of (email.attachments ?? []).entries()) {
        const content = Buffer.from(att.contentBase64, 'base64');
        await storage.put(
          `email-attachments/${tenant.userId}/${emailId}/${i.toString()}-${att.filename}`,
          content,
          att.mimeType
        );
        archivedBytes += content.byteLength;
      }
      await repos.emailMessages.setArchive(emailId, rawKey, archivedBytes);
      await repos.mailboxConnections.touchLastEvent(connection.id, new Date());

      // Classify against employer sender patterns (configuration, §12).
      const employers = await repos.employers.list();
      const employerPatterns = await Promise.all(
        employers.map(async (e) => {
          const config = await repos.employers.getConfig(e.id);
          return {
            slug: e.slug,
            employerId: e.id,
            senderPatterns: z.array(senderPatternSchema).parse(config?.config.senderPatterns ?? []),
            timezone: config?.config.timezone ?? 'Europe/London',
            scheme: config?.config.payPeriodScheme ?? null,
          };
        })
      );
      const { classification, employerSlug } = classifyEmail(
        {
          fromAddress: email.fromAddress,
          subject: email.subject,
          attachmentNames: (email.attachments ?? []).map((a) => a.filename),
        },
        employerPatterns
      );
      await repos.emailMessages.setClassification(emailId, classification);

      let parseStatus: 'PARSED' | 'QUARANTINED' | 'IGNORED' = 'IGNORED';
      const stats: Record<string, unknown> = { emailId, classification };

      const rotaKinds: EmailClassificationKind[] = ['ROTA', 'ROTA_CHANGE', 'CANCELLATION'];
      if (employerSlug && rotaKinds.includes(classification)) {
        const employer = employerPatterns.find((e) => e.slug === employerSlug);
        const parser = employer ? registry.findRotaParser(employerSlug) : null;
        const outcome = parser
          ? parser.parse({
              subject: email.subject,
              fromAddress: email.fromAddress,
              receivedAt: email.receivedAt,
              plaintextBody: metadata.plaintextBody ?? null,
              htmlBody: metadata.htmlBody ?? null,
              attachments: (email.attachments ?? []).map((a) => ({
                filename: a.filename,
                mimeType: a.mimeType,
              })),
            })
          : ({ ok: false, reason: 'NO_PARSER_REGISTERED' } as const);

        if (outcome.ok && employer) {
          const contracts = await repos.contracts.listByEmployer(employer.employerId);
          const active = contracts.filter((c) => c.endDate === null);
          const contract = active[0];
          if (active.length !== 1 || !contract) {
            parseStatus = 'QUARANTINED';
            stats.reason = 'AMBIGUOUS_CONTRACT';
          } else {
            const applied = await applyRotaCandidates(repos, {
              userId: tenant.userId,
              employerId: employer.employerId,
              timezone: employer.timezone,
              contractId: contract.id,
              emailId,
              receivedAt: email.receivedAt,
              candidates: outcome.shifts,
            });
            stats.applied = applied;
            parseStatus = applied.ambiguous > 0 ? 'QUARANTINED' : 'PARSED';
            if (employer.scheme && applied.created > 0) {
              const dates = outcome.shifts.map((s) => s.date).sort(compareIsoDates);
              for (const date of dates) {
                try {
                  await repos.payrollPeriods.ensure(
                    employer.employerId,
                    resolvePeriodFor(employer.scheme, date)
                  );
                } catch {
                  // Scheme doesn't cover this date; quarantine-level concern.
                }
              }
              await projector.recomputePeriodsTouching(tenant.userId, employer.employerId, dates);
            }
          }
        } else {
          parseStatus = 'QUARANTINED';
          stats.reason = outcome.ok ? 'UNKNOWN' : outcome.reason;
        }
        await repos.emailMessages.setParseOutcome(emailId, {
          status: parseStatus,
          parserId: parser?.id ?? null,
          parserVersion: parser?.version ?? null,
          parseError:
            parseStatus === 'QUARANTINED' && typeof stats.reason === 'string' ? stats.reason : null,
        });
        await notifyUser(db, tenant.userId, 'ROTA_INGESTED', {
          emailId,
          subject: email.subject,
          classification,
          parseStatus,
        });
      } else if (employerSlug && classification === 'PAYSLIP') {
        parseStatus = 'QUARANTINED';
        await repos.emailMessages.setParseOutcome(emailId, {
          status: parseStatus,
          parseError: 'PAYSLIP_PARSER_PENDING',
        });
        await notifyUser(db, tenant.userId, 'PAYSLIP_RECEIVED', {
          emailId,
          subject: email.subject,
        });
      } else {
        await repos.emailMessages.setParseOutcome(emailId, { status: 'IGNORED' });
      }

      stats.parseStatus = parseStatus;
      await db.ingestionRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), stats: stats as never },
      });
      await realtime.broadcast(tenant.userId, 'ingestion', {
        emailId,
        classification,
        parseStatus,
      });

      return { status: 'ACCEPTED', emailId, parseStatus, classification };
    },
  };
}

export type IngestionService = ReturnType<typeof createIngestionService>;
