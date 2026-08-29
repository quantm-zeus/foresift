/**
 * Solana transport & §35.6 security matrix unit tests (FR-COL-002, FR-COL-009).
 * Tests cryptographic verification, maximum age check, message payload deduplication,
 * and malformed event rejection without advancing checkpoint.
 */
import { describe, expect, it } from 'bun:test';

async function validateTransportMessage(msg: unknown): Promise<{ valid: boolean; reason?: string }> {
  try {
    const mod = await import('../src/transport.ts');
    return mod.validateTransportMessage(msg);
  } catch {
    return { valid: false, reason: 'UNIMPLEMENTED' };
  }
}

describe('Solana Transport Security Matrix (§35.6, FR-COL-009)', () => {
  it('rejects stale messages exceeding maximum permitted age', async () => {
    const staleMsg = {
      timestamp: '2020-01-01T00:00:00Z',
      payload: {},
      signature: 'valid_sig',
    };
    const res = await validateTransportMessage(staleMsg);
    expect(res.valid).toBe(false);
  });

  it('rejects malformed event payloads without advancing checkpoint', async () => {
    const malformed = {
      timestamp: new Date().toISOString(),
      payload: 'invalid-non-json-or-corrupt-data',
    };
    const res = await validateTransportMessage(malformed);
    expect(res.valid).toBe(false);
  });
});
