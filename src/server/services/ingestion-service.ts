import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { z } from 'zod';
import type { PushRequest } from '@/core/ingestion/provider';
import { classifyEmail } from '@/core/parsing/classifier';
import type { ParserRegistry } from '@/core/parsing/registry';
import type { CandidateShift, EmailClassificationKind } from '@/core/parsing/types';
import { senderPatternSchema } from '@/core/domain/employer/employer-config';
import { instantFromZoned } from '@/core/dates/zoned';
import { addDays, compareIsoDates, type IsoDate } from '@/core/dates/iso-date';
import { periodsBetween, resolvePeriodFor } from '@/core/domain/payroll-period/scheme';
import {
  PdfTextExtractionError,
  unpdfTextExtractor,
  type DocumentTextExtractor,
} from '@/server/integrations/documents/pdf-text';
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
  decryptField,
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
  documentTextExtractor?: DocumentTextExtractor;
}

export function createIngestionService(deps: IngestionServiceDeps) {
  const { db, storage, realtime, registry } = deps;
  const projector = deps.projector ?? noopPayrollProjector;
  const documentTextExtractor = deps.documentTextExtractor ?? unpdfTextExtractor;
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
      roleIdsBySlug: Record<string, string>;
      candidates: CandidateShift[];
      sourceKind: 'EVENT_CONFIRMATION' | 'WEEKLY_GRID';
      authoritativeDates: IsoDate[];
    }
  ): Promise<{
    created: number;
    amended: number;
    cancelled: number;
    unchanged: number;
    stale: number;
    ambiguous: number;
    affectedDates: IsoDate[];
  }> {
    let created = 0;
    let amended = 0;
    let cancelled = 0;
    let unchanged = 0;
    let stale = 0;
    let ambiguous = 0;
    const affectedDates = new Set<IsoDate>();
    const hfsRoleId = input.roleIdsBySlug['hands-free'] ?? null;
    const reservedParkingRoleId = input.roleIdsBySlug['reserved-parking'] ?? null;

    const incomingPriority = (roleId: string | null): number =>
      input.sourceKind === 'WEEKLY_GRID' || roleId === reservedParkingRoleId ? 2 : 1;

    const existingPriority = (
      externalRef: string | null,
      roleId: string | null,
      latest: { sourceEmailId: string | null; actor: string | null }
    ): number => {
      if (latest.actor === 'user') return 3;
      if (externalRef?.startsWith('hfs-grid:')) return 2;
      if (externalRef?.startsWith('cow:')) return roleId === reservedParkingRoleId ? 2 : 1;
      return latest.sourceEmailId ? 1 : 3;
    };

    const isOlderAtSameAuthority = (
      incoming: number,
      existing: number,
      latestOccurredAt: Date
    ): boolean => incoming === existing && input.receivedAt < latestOccurredAt;
    for (const candidate of input.candidates) {
      const startAt = instantFromZoned(candidate.date, candidate.startTime, input.timezone);
      let endDate = candidate.date;
      if (candidate.endTime <= candidate.startTime) endDate = addDays(candidate.date, 1);
      const endAt = instantFromZoned(endDate, candidate.endTime, input.timezone);

      const roleId = candidate.roleSlug ? (input.roleIdsBySlug[candidate.roleSlug] ?? null) : null;
      if (candidate.roleSlug && !roleId) {
        ambiguous += 1; // parser emitted a role this employer doesn't define
        continue;
      }

      // Matching, strongest key first: externalRef (stable across restated
      // confirmations) → same role on the same date (one shift per role per
      // day in the evidenced formats) → identical start instant.
      const sameDay = await repos.shifts.listBetween(candidate.date, candidate.date, {
        employerId: input.employerId,
      });
      const match =
        (candidate.externalRef
          ? sameDay.find((s) => s.snapshot.externalRef === candidate.externalRef)
          : undefined) ??
        (roleId ? sameDay.find((s) => s.snapshot.roleId === roleId) : undefined) ??
        sameDay.find((s) => s.snapshot.startAt.getTime() === startAt.getTime());

      if (match) {
        const history = await repos.shifts.getWithHistory(match.id);
        const latestEvent = history?.events.at(-1);
        if (!history || !latestEvent) {
          ambiguous += 1;
          continue;
        }

        const sameTimes =
          match.snapshot.startAt.getTime() === startAt.getTime() &&
          match.snapshot.endAt.getTime() === endAt.getTime();
        const venue = candidate.venue ?? match.snapshot.venue;
        const sameDetails =
          sameTimes &&
          match.snapshot.externalRef === candidate.externalRef &&
          match.snapshot.roleId === roleId &&
          match.snapshot.venue === venue &&
          match.snapshot.notes === candidate.notes;
        if (sameDetails && match.status !== 'CANCELLED') {
          unchanged += 1;
          continue;
        }

        const incoming = incomingPriority(roleId);
        const existing = existingPriority(
          match.snapshot.externalRef,
          match.snapshot.roleId,
          latestEvent
        );
        if (latestEvent.actor === 'user') {
          ambiguous += 1;
          continue;
        }
        if (
          incoming < existing ||
          isOlderAtSameAuthority(incoming, existing, latestEvent.occurredAt)
        ) {
          stale += 1;
          continue;
        }

        let current = history.shift;
        if (current.status === 'CANCELLED') {
          const reinstated = current.reinstate({
            sourceEmailId: input.emailId,
            occurredAt: input.receivedAt,
          });
          await repos.shifts.applyEvent(reinstated.shift, reinstated.event);
          current = reinstated.shift;
        }

        const changes = {
          externalRef: candidate.externalRef,
          startAt,
          endAt,
          roleId,
          venue,
          notes: candidate.notes,
        };
        const currentDetailsMatch =
          current.snapshot.externalRef === changes.externalRef &&
          current.snapshot.startAt.getTime() === changes.startAt.getTime() &&
          current.snapshot.endAt.getTime() === changes.endAt.getTime() &&
          current.snapshot.roleId === changes.roleId &&
          current.snapshot.venue === changes.venue &&
          current.snapshot.notes === changes.notes;
        if (!currentDetailsMatch) {
          const changed = current.amend(changes, {
            sourceEmailId: input.emailId,
            occurredAt: input.receivedAt,
          });
          await repos.shifts.applyEvent(changed.shift, changed.event);
        }
        amended += 1;
        affectedDates.add(candidate.date);
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
          roleId,
          venue: candidate.venue,
          notes: candidate.notes,
        },
        evidence: { sourceEmailId: input.emailId, occurredAt: input.receivedAt },
      });
      await repos.shifts.create(shift, event);
      created += 1;
      affectedDates.add(candidate.date);
    }

    if (input.sourceKind === 'WEEKLY_GRID' && hfsRoleId) {
      const representedDates = new Set(
        input.candidates
          .filter((candidate) => candidate.roleSlug === 'hands-free')
          .map((candidate) => candidate.date)
      );
      for (const date of input.authoritativeDates) {
        if (representedDates.has(date)) continue;
        const sameDay = await repos.shifts.listBetween(date, date, {
          employerId: input.employerId,
        });
        for (const existingShift of sameDay) {
          if (
            existingShift.status === 'CANCELLED' ||
            existingShift.snapshot.roleId !== hfsRoleId ||
            !(
              existingShift.snapshot.externalRef?.startsWith('hfs-grid:') ||
              existingShift.snapshot.externalRef?.startsWith('cow:')
            )
          ) {
            continue;
          }
          const history = await repos.shifts.getWithHistory(existingShift.id);
          const latestEvent = history?.events.at(-1);
          if (!history || !latestEvent) {
            ambiguous += 1;
            continue;
          }
          const incoming = incomingPriority(hfsRoleId);
          const existing = existingPriority(
            existingShift.snapshot.externalRef,
            existingShift.snapshot.roleId,
            latestEvent
          );
          if (latestEvent.actor === 'user') {
            ambiguous += 1;
            continue;
          }
          if (
            incoming < existing ||
            isOlderAtSameAuthority(incoming, existing, latestEvent.occurredAt)
          ) {
            stale += 1;
            continue;
          }
          const result = history.shift.cancel({
            sourceEmailId: input.emailId,
            occurredAt: input.receivedAt,
          });
          await repos.shifts.applyEvent(result.shift, result.event);
          cancelled += 1;
          affectedDates.add(date);
        }
      }
    }

    return {
      created,
      amended,
      cancelled,
      unchanged,
      stale,
      ambiguous,
      affectedDates: [...affectedDates].sort(compareIsoDates),
    };
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
      const archivedAttachments: {
        filename: string;
        mimeType: string;
        storageKey: string;
        content: Uint8Array;
      }[] = [];
      for (const [i, att] of (email.attachments ?? []).entries()) {
        const content = Buffer.from(att.contentBase64, 'base64');
        const storageKey = `email-attachments/${tenant.userId}/${emailId}/${i.toString()}-${att.filename}`;
        await storage.put(storageKey, content, att.mimeType);
        archivedAttachments.push({
          filename: att.filename,
          mimeType: att.mimeType,
          storageKey,
          content,
        });
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
            rosterNames: config?.config.rosterNames ?? [],
            roleIdsBySlug: config?.roleIdsBySlug ?? {},
            payslipPdfPasswordEncrypted: config?.payslipPdfPasswordEncrypted ?? null,
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
              selfIdentifiers: employer?.rosterNames ?? [],
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
              roleIdsBySlug: employer.roleIdsBySlug,
              candidates: outcome.shifts,
              sourceKind: outcome.sourceKind,
              authoritativeDates: outcome.authoritativeDates,
            });
            stats.applied = applied;
            parseStatus = applied.ambiguous > 0 ? 'QUARANTINED' : 'PARSED';
            if (applied.ambiguous > 0) stats.reason = 'APPLY_AMBIGUITY';
            if (employer.scheme && applied.created + applied.amended + applied.cancelled > 0) {
              const dates = applied.affectedDates;
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
        const employer = employerPatterns.find((item) => item.slug === employerSlug);
        const parser = registry.findPayslipParser(employerSlug);
        const pdfs = archivedAttachments.filter(
          (attachment) =>
            attachment.mimeType === 'application/pdf' || /\.pdf$/i.test(attachment.filename)
        );
        parseStatus = 'QUARANTINED';

        if (!employer) {
          stats.reason = 'EMPLOYER_NOT_FOUND';
        } else if (!parser) {
          stats.reason = 'NO_PAYSLIP_PARSER_REGISTERED';
        } else if (pdfs.length !== 1) {
          stats.reason = pdfs.length === 0 ? 'PAYSLIP_PDF_NOT_FOUND' : 'MULTIPLE_PAYSLIP_PDFS';
        } else {
          const pdf = pdfs[0];
          if (!pdf) {
            stats.reason = 'PAYSLIP_PDF_NOT_FOUND';
          } else {
            let passwordDecrypted = false;
            try {
              let pdfPassword: string | undefined;
              if (employer.payslipPdfPasswordEncrypted) {
                pdfPassword = decryptField(employer.payslipPdfPasswordEncrypted);
                passwordDecrypted = true;
              }
              const textContent = await documentTextExtractor.extractPdfText(
                pdf.content,
                pdfPassword ? { password: pdfPassword } : undefined
              );
              const outcome = parser.parse({
                filename: pdf.filename,
                mimeType: pdf.mimeType,
                textContent,
              });
              if (!outcome.ok) {
                stats.reason = outcome.reason;
              } else if (!employer.scheme) {
                stats.reason = 'PAY_PERIOD_SCHEME_NOT_CONFIGURED';
              } else {
                const contracts = await repos.contracts.listByEmployer(employer.employerId);
                const activeContracts = contracts.filter((contract) => contract.endDate === null);
                const contract = activeContracts[0];
                if (activeContracts.length !== 1 || !contract) {
                  stats.reason = 'AMBIGUOUS_CONTRACT';
                } else {
                  const spans = periodsBetween(
                    employer.scheme,
                    addDays(outcome.payslip.payDate, -45),
                    outcome.payslip.payDate
                  );
                  const span =
                    spans.find((item) => item.payDate === outcome.payslip.payDate) ?? null;
                  if (!span) {
                    stats.reason = 'PAY_PERIOD_NOT_FOUND';
                  } else {
                    const period = await repos.payrollPeriods.ensure(employer.employerId, span);
                    const existing = await repos.payslips.forPeriod(period.id);
                    const sameAsExisting =
                      existing !== null &&
                      existing.payDate === outcome.payslip.payDate &&
                      existing.grossPence === outcome.payslip.grossPence &&
                      existing.taxPence === outcome.payslip.taxPence &&
                      existing.niPence === outcome.payslip.niPence &&
                      existing.pensionPence === outcome.payslip.pensionPence &&
                      existing.netPence === outcome.payslip.netPence;

                    if (existing && !sameAsExisting) {
                      stats.reason = 'PAYSLIP_PERIOD_CONFLICT';
                    } else {
                      if (!existing) {
                        const saved = await repos.payslips.create({
                          employerId: employer.employerId,
                          contractId: contract.id,
                          payrollPeriodId: period.id,
                          sourceEmailId: emailId,
                          documentStorageKey: pdf.storageKey,
                          payDate: outcome.payslip.payDate,
                          grossPence: outcome.payslip.grossPence,
                          taxPence: outcome.payslip.taxPence,
                          niPence: outcome.payslip.niPence,
                          pensionPence: outcome.payslip.pensionPence,
                          netPence: outcome.payslip.netPence,
                          ytd: outcome.payslip.ytd,
                          lines: outcome.payslip.lines,
                        });
                        stats.payslipId = saved.id;
                        await projector.recomputePeriodsTouching(
                          tenant.userId,
                          employer.employerId,
                          [outcome.payslip.payDate]
                        );
                      } else {
                        stats.idempotentPayslip = true;
                      }
                      parseStatus = 'PARSED';
                    }
                  }
                }
              }
            } catch (error) {
              stats.reason =
                error instanceof PdfTextExtractionError
                  ? error.code
                  : employer.payslipPdfPasswordEncrypted && !passwordDecrypted
                    ? 'PDF_PASSWORD_DECRYPTION_FAILED'
                    : 'PDF_TEXT_EXTRACTION_FAILED';
            }
          }
        }

        await repos.emailMessages.setParseOutcome(emailId, {
          status: parseStatus,
          parserId: parser?.id ?? null,
          parserVersion: parser?.version ?? null,
          parseError:
            parseStatus === 'QUARANTINED' && typeof stats.reason === 'string' ? stats.reason : null,
        });
        await notifyUser(db, tenant.userId, 'PAYSLIP_RECEIVED', {
          emailId,
          parseStatus,
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
