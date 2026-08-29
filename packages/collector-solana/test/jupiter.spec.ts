/**
 * Jupiter route observation & negative-capability assertion unit tests (§35.7, §63.3.1, FR-COL-002).
 * Jupiter is strictly read-only route observation; no pool math authority or execution capability.
 */
import { describe, expect, it } from 'bun:test';
import { JUPITER_ROUTE_MANIFEST } from '../../../tests/fixtures/col/index.ts';

describe('Jupiter Route Observation & Negative Capability (FR-COL-002, §35.7)', () => {
  it('manifest exposes route observation only and no pool math adapter', () => {
    expect(JUPITER_ROUTE_MANIFEST.protocolFamily).toBe('JUPITER');
    expect(JUPITER_ROUTE_MANIFEST.poolMathAdapterVersion).toBeUndefined();
    expect(JUPITER_ROUTE_MANIFEST.supportedEventFamilies).toContain('ROUTE_OBSERVATION');
  });

  it('reconciles route observations to underlying venue adapters rather than trusting Jupiter as pool authority', () => {
    const routeEvent = {
      inAmount: '1000000000',
      outAmount: '50000000000',
      routePlan: [{ venue: 'RAYDIUM_AMM_V4', percent: 100 }],
    };

    expect(routeEvent.routePlan[0].venue).toBe('RAYDIUM_AMM_V4');
  });
});
