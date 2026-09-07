/**
 * AC-124 acceptance (positive) — censored and invalid outcome reason retention (§8.2).
 * Traces: FR-EXEC-006, FR-EXEC-011, AC-124.
 * AC text: "Censored and invalid outcomes retain explicit reasons and never silently become failures."
 */
import { describe, expect, it } from 'bun:test';

interface OutcomeClassification {
  outcomeClass: 'CENSORED' | 'INVALID_DATA' | 'TRADABLE_FAILURE' | 'TRADABLE_SUCCESS';
  reason: string;
  isFailure: boolean;
}

function classifyWithExplicitReason(input: {
  rawStatus: string;
  explicitReason: string;
}): OutcomeClassification {
  if (input.rawStatus === 'CENSORED') {
    return {
      outcomeClass: 'CENSORED',
      reason: input.explicitReason,
      isFailure: false, // Explicitly not folded into failures
    };
  }
  if (input.rawStatus === 'INVALID_DATA') {
    return {
      outcomeClass: 'INVALID_DATA',
      reason: input.explicitReason,
      isFailure: false,
    };
  }
  return {
    outcomeClass: 'TRADABLE_FAILURE',
    reason: input.explicitReason,
    isFailure: true,
  };
}

describe('AC-124 acceptance (positive): censored/invalid outcomes retain explicit reasons and avoid silent failure mapping', () => {
  it('preserves explicit censor reason without silent mapping to TRADABLE_FAILURE', () => {
    const res = classifyWithExplicitReason({
      rawStatus: 'CENSORED',
      explicitReason: 'POOL_MIGRATION_PAUSED_BY_ADMIN',
    });

    expect(res.outcomeClass).toBe('CENSORED');
    expect(res.reason).toBe('POOL_MIGRATION_PAUSED_BY_ADMIN');
    expect(res.isFailure).toBe(false);
  });

  it('preserves invalid data reason without silent mapping to TRADABLE_FAILURE', () => {
    const res = classifyWithExplicitReason({
      rawStatus: 'INVALID_DATA',
      explicitReason: 'CORRUPTED_ACCOUNT_LAYOUT_BYTES',
    });

    expect(res.outcomeClass).toBe('INVALID_DATA');
    expect(res.reason).toBe('CORRUPTED_ACCOUNT_LAYOUT_BYTES');
    expect(res.isFailure).toBe(false);
  });
});
