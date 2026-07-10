import { z } from 'zod';
import type {
  IncomingEmail,
  PushEmailIngestionProvider,
  PushRequest,
  PushSignatureVerifier,
  PushVerification,
} from '@/core/ingestion/provider';

/**
 * Apps Script push provider (ADR 1/11). The user's own Google Apps Script
 * POSTs new emails here, signed with an HKDF-derived per-connection key.
 * Signature is HMAC-SHA256 over `${timestamp}.${rawBody}`; the timestamp
 * header must be within the replay window. Emails are hostile input — the
 * payload is zod-parsed before anything downstream sees it.
 */

export const REPLAY_WINDOW_SECONDS = 300;

const attachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  contentBase64: z.string(),
});

const pushPayloadSchema = z.object({
  connectionId: z.string().min(1),
  message: z.object({
    providerMessageId: z.string().min(1).max(255),
    receivedAt: z.string().datetime(),
    subject: z.string().max(1000).default('(no subject)'),
    fromAddress: z.string().min(1).max(320),
    plaintextBody: z.string().max(500_000).nullish(),
    htmlBody: z.string().max(1_000_000).nullish(),
    rawMimeBase64: z.string().nullish(),
    attachments: z.array(attachmentSchema).max(10).default([]),
  }),
});

export type AppsScriptPushPayload = z.infer<typeof pushPayloadSchema>;

export const appsScriptPushProvider: PushEmailIngestionProvider = {
  kind: 'APPS_SCRIPT_PUSH',
  mode: 'push',

  async parseAndVerify(
    request: PushRequest,
    verifier: PushSignatureVerifier
  ): Promise<PushVerification> {
    const timestamp = request.headers['x-shiftsync-timestamp'];
    const signature = request.headers['x-shiftsync-signature'];
    if (!timestamp || !signature) {
      return { ok: false, reason: 'MALFORMED', detail: 'missing signature headers' };
    }

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return { ok: false, reason: 'MALFORMED', detail: 'bad timestamp' };
    const skew = Math.abs(request.receivedAt.getTime() / 1000 - ts);
    if (skew > REPLAY_WINDOW_SECONDS) return { ok: false, reason: 'STALE_TIMESTAMP' };

    let parsed: AppsScriptPushPayload;
    try {
      parsed = pushPayloadSchema.parse(JSON.parse(request.rawBody));
    } catch (e) {
      return { ok: false, reason: 'MALFORMED', detail: e instanceof Error ? e.message : 'parse' };
    }

    const valid = await verifier.verify({
      mailboxConnectionId: parsed.connectionId,
      signature,
      signedPayload: `${timestamp}.${request.rawBody}`,
    });
    if (!valid) return { ok: false, reason: 'BAD_SIGNATURE' };

    const m = parsed.message;
    const email: IncomingEmail = {
      providerMessageId: m.providerMessageId,
      receivedAt: new Date(m.receivedAt),
      subject: m.subject,
      fromAddress: m.fromAddress,
      ...(m.rawMimeBase64 ? { rawMimeBase64: m.rawMimeBase64 } : {}),
      attachments: m.attachments,
      metadata: {
        plaintextBody: m.plaintextBody ?? null,
        htmlBody: m.htmlBody ?? null,
      },
    };
    return { ok: true, mailboxConnectionId: parsed.connectionId, email };
  },
};
