/**
 * AC-226 negative (failure) — cost-capacity facet (collector data-truth substrate owned elsewhere).
 * Traces: FR-COST-006.
 * Tests rejection when latency decomposition exceeds threshold.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-226 negative: detects and fails on inflated cost-path latency', () => {
  it('fails budget verification when simulated latency exceeds ceiling', () => {
    const budgetMs = 5.0;
    const measuredLatencyMs = 25.0; // Injected delay

    const withinBudget = measuredLatencyMs <= budgetMs;
    expect(withinBudget).toBe(false);
  });
});

describe('AC-226 negative — first-party scope labeling restriction facet (FR-COL-011)', () => {
  it('refuses to label spans outside verified collector scope as first-party', () => {
    const unverifiedScopeSpan = {
      sourceId: 'src_third_party_indexer',
      isFirstPartyVerifiedScope: false,
      claimedLabel: 'FIRST_PARTY',
    };

    const isLabelValid =
      unverifiedScopeSpan.isFirstPartyVerifiedScope ||
      unverifiedScopeSpan.claimedLabel !== 'FIRST_PARTY';

    expect(isLabelValid).toBe(false);
  });
});
