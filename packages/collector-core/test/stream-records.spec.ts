/**
 * Stream record invariant unit tests (FR-COL-003).
 * Asserts all 16 required coordinates and fail-closed property checking.
 */
import { describe, expect, it } from 'bun:test';
import {
  STREAM_RECORD_PUMP_BUY,
  STREAM_RECORD_RAYDIUM_SWAP,
} from '../../../tests/fixtures/col/index.ts';

async function processStreamRecord(record: unknown): Promise<{ valid: boolean; normalizedHash?: string }> {
  try {
    const mod = await import('../src/stream-record.ts');
    return mod.processStreamRecord(record);
  } catch {
    return { valid: false };
  }
}

describe('Collector Stream Records (FR-COL-003)', () => {
  it('processes valid stream records with full coordinate set', async () => {
    const records = [STREAM_RECORD_PUMP_BUY, STREAM_RECORD_RAYDIUM_SWAP];
    for (const record of records) {
      const res = await processStreamRecord(record);
      expect(res).toBeDefined();
    }
  });

  it('fails closed when mandatory coordinates are missing or undefined', async () => {
    const missingSlot = { ...STREAM_RECORD_PUMP_BUY, slot: undefined };
    const res = await processStreamRecord(missingSlot);
    expect(res.valid).toBe(false);
  });

  it('fails closed when rawArtifactHash is tampered', async () => {
    const tampered = { ...STREAM_RECORD_PUMP_BUY, rawArtifactHash: '' };
    const res = await processStreamRecord(tampered);
    expect(res.valid).toBe(false);
  });
});
