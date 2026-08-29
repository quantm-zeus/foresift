/**
 * Pump / PumpSwap decoder vectors unit tests (FR-COL-002).
 */
import { describe, expect, it } from 'bun:test';
import {
  ADVERSARIAL_PUMP_CORRUPTED_DISCRIMINATOR,
  STREAM_RECORD_PUMP_BUY,
} from '../../../tests/fixtures/col/index.ts';

describe('Pump & PumpSwap Decoder (FR-COL-002)', () => {
  it('decodes valid Pump bonding curve buy event payload', () => {
    const payload = STREAM_RECORD_PUMP_BUY.payload;
    expect(payload.side).toBe('BUY');
    expect(payload.solAmountLamports).toBe('1000000000');
    expect(payload.virtualSolReserves).toBeDefined();
    expect(payload.virtualTokenReserves).toBeDefined();
  });

  it('rejects adversarial account layout with corrupted discriminator', () => {
    expect(ADVERSARIAL_PUMP_CORRUPTED_DISCRIMINATOR.expectedFailureReason).toBe(
      'INVALID_ACCOUNT_DISCRIMINATOR',
    );
    expect(ADVERSARIAL_PUMP_CORRUPTED_DISCRIMINATOR.expectedQualityCode).toBe('SCHEMA_DEGRADED');
  });
});
