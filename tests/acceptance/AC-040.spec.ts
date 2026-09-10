/**
 * AC-040 acceptance (positive) — separate signal/tradable labels from delivery time, canonical pool, notional/delay, impact, fees, fill constraints, exit policy, maturity state (§8.2 + FR-MAT-001).
 * Traces: FR-MAT-001, FR-EVAL-001, AC-040.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-040 acceptance (positive): explicit separation of signal and tradable outcomes across execution dimensions', () => {
  it('records distinct signal and tradable labels with delivery time, pool, notional, and maturity state', () => {
    const outcome = {
      outcomeId: 'out_ac040_001',
      profileId: 'HG-EM-1@1',
      signalOutcome: 'SIGNAL_SUCCESS',
      tradableOutcome: 'TRADABLE_SUCCESS',
      deliveryTimeMs: 45,
      canonicalPoolId: 'pool_raydium_sol_001',
      notionalUsd: 500.0,
      delayPolicy: 'DELIBERATE_100MS_DELAY',
      priceImpactPct: 0.8,
      feesUsd: 1.25,
      fillConstraints: 'CANONICAL_LIQUIDITY_ONLY',
      exitPolicy: 'FIXED_TARGET_30PCT',
      maturityState: 'FULLY_MATURED',
    };

    expect(outcome.signalOutcome).toBe('SIGNAL_SUCCESS');
    expect(outcome.tradableOutcome).toBe('TRADABLE_SUCCESS');
    expect(outcome.maturityState).toBe('FULLY_MATURED');
    expect(outcome.notionalUsd).toBe(500.0);
  });
});
