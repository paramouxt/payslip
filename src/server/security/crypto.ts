import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Field-level crypto. Master key: APP_ENCRYPTION_KEY (base64, 32 bytes).
 *  - encryptField/decryptField: AES-256-GCM for stored sensitive fields
 *    (employee refs, payslip refs). Format: v1.<iv>.<ciphertext>.<tag> (b64).
 *  - deriveIngestionKey: HKDF-derived per-connection HMAC keys (constitution
 *    §7 as amended): nothing recoverable at rest — DB stores only the key
 *    version and a verification hash; a database breach alone yields nothing.
 */

function masterKey(): Buffer {
  const raw = env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (base64)');
  return key;
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${ciphertext.toString('base64')}.${tag.toString('base64')}`;
}

export function decryptField(stored: string): string {
  const [version, ivB64, ctB64, tagB64] = stored.split('.');
  if (version !== 'v1' || !ivB64 || !ctB64 || !tagB64) {
    throw new Error('unrecognised encrypted field format');
  }
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
    'utf8'
  );
}

export function deriveIngestionKey(connectionId: string, keyVersion: number): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      masterKey(),
      Buffer.alloc(0),
      `shiftsync:ingest-hmac:${connectionId}:v${keyVersion.toString()}`,
      32
    )
  );
}

export function ingestionKeyVerificationHash(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex');
}

export function hmacSha256Hex(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

/** Constant-time hex comparison; false on length mismatch or bad hex. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let bufA: Buffer;
  let bufB: Buffer;
  try {
    bufA = Buffer.from(a, 'hex');
    bufB = Buffer.from(b, 'hex');
  } catch {
    return false;
  }
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
