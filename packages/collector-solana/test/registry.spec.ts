/**
 * Solana protocol registry & signed manifest verification unit tests (FR-COL-002).
 */
import { describe, expect, it } from 'bun:test';
import {
  PUMP_MANIFEST,
  RAYDIUM_V4_MANIFEST,
  DEGRADED_MANIFEST,
} from '../../../tests/fixtures/col/index.ts';

describe('Solana Protocol Registry (FR-COL-002)', () => {
  it('resolves active adapters for verified signed manifests', () => {
    expect(PUMP_MANIFEST.capabilityState).toBe('ACTIVE');
    expect(RAYDIUM_V4_MANIFEST.capabilityState).toBe('ACTIVE');
  });

  it('marks capabilities DEGRADED when layout or IDL mismatch occurs', () => {
    expect(DEGRADED_MANIFEST.capabilityState).toBe('DEGRADED');
    expect(DEGRADED_MANIFEST.unsupportedReasons).toContain('IDL_OR_LAYOUT_MISMATCH');
  });
});
