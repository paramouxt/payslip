import { describe, expect, it } from 'vitest';
import {
  decryptField,
  deriveIngestionKey,
  encryptField,
  hmacSha256Hex,
  ingestionKeyVerificationHash,
  safeEqualHex,
} from '@/server/security/crypto';

describe('field encryption', () => {
  it('round-trips and never repeats ciphertext (random IV)', () => {
    const a = encryptField('EMP-12345');
    const b = encryptField('EMP-12345');
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe('EMP-12345');
    expect(decryptField(b)).toBe('EMP-12345');
  });

  it('rejects tampered ciphertext (GCM auth)', () => {
    const stored = encryptField('secret');
    const parts = stored.split('.');
    const tampered = `${parts[0] ?? ''}.${parts[1] ?? ''}.${Buffer.from('tamperedtampered').toString('base64')}.${parts[3] ?? ''}`;
    expect(() => decryptField(tampered)).toThrow();
  });
});

describe('ingestion key derivation', () => {
  it('is deterministic per (connection, version) and distinct across both', () => {
    const k1 = deriveIngestionKey('conn_a', 1);
    expect(deriveIngestionKey('conn_a', 1).equals(k1)).toBe(true);
    expect(deriveIngestionKey('conn_a', 2).equals(k1)).toBe(false);
    expect(deriveIngestionKey('conn_b', 1).equals(k1)).toBe(false);
  });

  it('verification hash matches only the right key', () => {
    const k = deriveIngestionKey('conn_a', 1);
    expect(ingestionKeyVerificationHash(k)).toBe(ingestionKeyVerificationHash(k));
    expect(ingestionKeyVerificationHash(deriveIngestionKey('conn_a', 2))).not.toBe(
      ingestionKeyVerificationHash(k)
    );
  });
});

describe('safeEqualHex', () => {
  it('compares equal/unequal/hostile inputs safely', () => {
    const key = deriveIngestionKey('conn_a', 1);
    const sig = hmacSha256Hex(key, 'payload');
    expect(safeEqualHex(sig, sig)).toBe(true);
    expect(safeEqualHex(sig, hmacSha256Hex(key, 'other'))).toBe(false);
    expect(safeEqualHex(sig, sig.slice(1))).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
    expect(safeEqualHex('zz', 'zz')).toBe(false);
  });
});
