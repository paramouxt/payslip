import type { TenantRepositories } from '@/server/repositories';
import { deriveIngestionKey, ingestionKeyVerificationHash } from '@/server/security/crypto';
import { buildAppsScriptForwarder } from '@/server/templates/apps-script-forwarder';

/**
 * Mailbox connection lifecycle. Keys are HKDF-derived, so the "secret" shown
 * to the user is reproducible server-side for the connection's owner — there
 * is nothing recoverable at rest to leak (§7 as amended, ADR 15).
 */
export function createMailboxService(repos: TenantRepositories) {
  return {
    async createAppsScriptConnection(input: { label: string; emailAddress?: string }) {
      const connection = await repos.mailboxConnections.create({
        provider: 'APPS_SCRIPT_PUSH',
        label: input.label,
        emailAddress: input.emailAddress ?? null,
        keyVersion: 1,
        verificationHash: '', // replaced below once the id exists
      });
      const key = deriveIngestionKey(connection.id, 1);
      await repos.mailboxConnections.rotateKey(connection.id, 1, ingestionKeyVerificationHash(key));
      return connection;
    },

    async rotate(connectionId: string) {
      const connection = await repos.mailboxConnections.getById(connectionId);
      if (!connection) throw new Error('connection not found');
      const nextVersion = connection.activeKeyVersion + 1;
      const key = deriveIngestionKey(connectionId, nextVersion);
      await repos.mailboxConnections.rotateKey(
        connectionId,
        nextVersion,
        ingestionKeyVerificationHash(key)
      );
      return nextVersion;
    },

    /** Owner-facing material: derived key + ready-to-paste forwarder script. */
    describeForOwner(connection: { id: string; activeKeyVersion: number }, appUrl: string) {
      const key = deriveIngestionKey(connection.id, connection.activeKeyVersion);
      const keyHex = key.toString('hex');
      return {
        endpoint: `${appUrl}/api/ingest/email`,
        connectionId: connection.id,
        keyHex,
        script: buildAppsScriptForwarder({
          endpoint: `${appUrl}/api/ingest/email`,
          connectionId: connection.id,
          keyHex,
        }),
      };
    },
  };
}
