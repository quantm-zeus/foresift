/**
 * Meteora DLMM, DAMM v1/v2, DBC decoder vectors unit tests (FR-COL-002).
 */
import { describe, expect, it } from 'bun:test';
import { METEORA_DLMM_MANIFEST, METEORA_DBC_MANIFEST } from '../../../tests/fixtures/col/index.ts';

describe('Meteora Protocol Family Decoders (FR-COL-002)', () => {
  it('DLMM manifest specifies LbPair and BinArray account families', () => {
    expect(METEORA_DLMM_MANIFEST.requiredAccountFamilies).toContain('LbPair');
    expect(METEORA_DLMM_MANIFEST.requiredAccountFamilies).toContain('BinArray');
  });

  it('DBC manifest specifies Dynamic Bonding Curve virtual pool lifecycle', () => {
    expect(METEORA_DBC_MANIFEST.requiredAccountFamilies).toContain('VirtualPool');
    expect(METEORA_DBC_MANIFEST.supportedEventFamilies).toContain('BONDING_CURVE_INIT');
  });
});
