import { describe, expect, it } from 'bun:test';
import {
  ALL_MARKET_CAP_BASES,
  ALL_SUPPLY_METHODS,
  MarketCapBasis,
  SupplyMethod,
  marketCapBasis,
  marketCapMayHardReject,
  supplyMethod,
} from '../src/index.ts';

describe('Supply vocabulary and market cap fallback predicate (FR-SUP-001, FR-SUP-002, AC-135)', () => {
  it('declares the SupplyMethod vocabulary', () => {
    const expected = ['TOTAL', 'PROVIDER_CIRCULATING', 'ESTIMATED_CIRCULATING'].sort();
    expect([...ALL_SUPPLY_METHODS].sort()).toEqual(expected as SupplyMethod[]);
  });

  it('declares the MarketCapBasis vocabulary', () => {
    const expected = ['TOTAL', 'PROVIDER_CIRCULATING', 'ESTIMATED_CIRCULATING'].sort();
    expect([...ALL_MARKET_CAP_BASES].sort()).toEqual(expected as MarketCapBasis[]);
  });

  it('parses valid supply methods fail-closed', () => {
    expect(supplyMethod('TOTAL')).toBe(SupplyMethod.TOTAL);
    expect(supplyMethod('PROVIDER_CIRCULATING')).toBe(SupplyMethod.PROVIDER_CIRCULATING);
    expect(supplyMethod('ESTIMATED_CIRCULATING')).toBe(SupplyMethod.ESTIMATED_CIRCULATING);
  });

  it('refuses unknown supply methods fail-closed', () => {
    expect(() => supplyMethod('UNOFFICIAL_GUESS')).toThrow();
    expect(() => supplyMethod('')).toThrow();
  });

  it('evaluates pure marketCapMayHardReject predicate (plan ADR-4)', () => {
    // Low confidence WITH approved fallback -> MUST NOT hard reject
    const lowConfWithFallback = {
      assessment: {
        confidence: 0.3,
        qualityCodes: ['SUPPLY_UNCERTAIN'],
      },
      approvedFallbackAvailable: true,
    };
    expect(
      marketCapMayHardReject(
        lowConfWithFallback.assessment,
        lowConfWithFallback.approvedFallbackAvailable,
      ),
    ).toBe(false);

    // Low confidence WITHOUT approved fallback -> MAY hard reject
    const lowConfNoFallback = {
      assessment: {
        confidence: 0.3,
        qualityCodes: ['SUPPLY_UNCERTAIN'],
      },
      approvedFallbackAvailable: false,
    };
    expect(
      marketCapMayHardReject(
        lowConfNoFallback.assessment,
        lowConfNoFallback.approvedFallbackAvailable,
      ),
    ).toBe(true);

    // High confidence -> MAY hard reject based on actual values
    const highConf = {
      assessment: {
        confidence: 0.95,
        qualityCodes: ['VALID'],
      },
      approvedFallbackAvailable: true,
    };
    expect(marketCapMayHardReject(highConf.assessment, highConf.approvedFallbackAvailable)).toBe(
      true,
    );
  });
});
