/**
 * Raydium AMM v4, CPMM, CLMM, Stable AMM decoder vectors unit tests (FR-COL-002).
 */
import { describe, expect, it } from 'bun:test';
import {
  ADVERSARIAL_RAYDIUM_TRUNCATED_LAYOUT,
  STREAM_RECORD_RAYDIUM_SWAP,
} from '../../../tests/fixtures/col/index.ts';

describe('Raydium Protocol Family Decoders (FR-COL-002)', () => {
  it('decodes valid Raydium AMM v4 swap event', () => {
    const payload = STREAM_RECORD_RAYDIUM_SWAP.payload;
    expect(payload.poolAddress).toBeDefined();
    expect(payload.amountIn).toBe('500000000');
    expect(payload.amountOut).toBe('25000000000');
  });

  it('rejects truncated adversarial account layout', () => {
    expect(ADVERSARIAL_RAYDIUM_TRUNCATED_LAYOUT.expectedFailureReason).toBe(
      'UNEXPECTED_EOF_TRUNCATED_ACCOUNT',
    );
    expect(ADVERSARIAL_RAYDIUM_TRUNCATED_LAYOUT.expectedQualityCode).toBe('SCHEMA_DEGRADED');
  });
});
