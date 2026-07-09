/**
 * EmailIngestionProvider — the provider-agnostic port between "somewhere email
 * arrives" and the ingestion pipeline (architecture §14.1 / ADR 11).
 *
 * Two shapes exist because they are architecturally different:
 *  - PUSH: the mailbox calls us (Apps Script forwarder, generic signed
 *    webhook). The adapter's job is verification + extraction of the payload.
 *  - PULL: we poll the mailbox with an opaque cursor (Gmail API historyId,
 *    IMAP UIDNEXT, MS Graph delta token). Credential handling lives entirely
 *    inside the adapter.
 *
 * Everything downstream of IngestionService.receive(IncomingEmail) is
 * provider-blind.
 */

export type EmailProviderKind =
  'APPS_SCRIPT_PUSH' | 'GENERIC_WEBHOOK' | 'GMAIL_API' | 'IMAP' | 'MS_GRAPH';

export interface IncomingEmailAttachment {
  filename: string;
  mimeType: string;
  contentBase64: string;
}

export interface IncomingEmail {
  /** Provider-scoped stable id (Gmail message id, IMAP UID, …). */
  providerMessageId: string;
  receivedAt: Date;
  subject: string;
  fromAddress: string;
  /** Complete RFC 822 message when the provider can supply it — archived immutably. */
  rawMimeBase64?: string;
  attachments?: IncomingEmailAttachment[];
  /** Provider-specific extras; never required downstream. */
  metadata?: Record<string, unknown>;
}

export interface PushRequest {
  headers: Record<string, string | undefined>;
  /** Exact raw body bytes as received — signatures verify bytes, not parses. */
  rawBody: string;
  receivedAt: Date;
}

/** Looks up and checks the signature for a mailbox connection's secret(s).
 *  Implemented server-side (hashed secrets, rotation, revocation). */
export interface PushSignatureVerifier {
  verify(input: {
    mailboxConnectionId: string;
    signature: string;
    signedPayload: string;
  }): Promise<boolean>;
}

export type PushVerification =
  | { ok: true; mailboxConnectionId: string; email: IncomingEmail }
  | {
      ok: false;
      reason: 'BAD_SIGNATURE' | 'STALE_TIMESTAMP' | 'MALFORMED' | 'UNKNOWN_CONNECTION';
      detail?: string;
    };

export interface PushEmailIngestionProvider {
  readonly kind: EmailProviderKind;
  readonly mode: 'push';
  parseAndVerify(request: PushRequest, verifier: PushSignatureVerifier): Promise<PushVerification>;
}

export interface PullResult {
  emails: IncomingEmail[];
  /** Opaque; persist and hand back on the next pull. Null = start from now. */
  nextCursor: string | null;
}

export interface PullEmailIngestionProvider {
  readonly kind: EmailProviderKind;
  readonly mode: 'pull';
  pull(cursor: string | null): Promise<PullResult>;
}

export type EmailIngestionProvider = PushEmailIngestionProvider | PullEmailIngestionProvider;
