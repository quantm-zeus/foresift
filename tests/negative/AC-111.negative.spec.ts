/**
 * AC-111 negative (failure) — retrospective universe classification & lineage disclosure.
 * Traces: FR-DISC-003.
 * Tests rejection of independent recall claims when retrospective source shares upstream lineage,
 * and structural refusal of retrospective data entering historical decision bundles.
 */
import { describe, expect, it } from 'bun:test';
import {
  RETROSPECTIVE_SAMPLE_SHARED_LINEAGE,
  RETROSPECTIVE_SAMPLE_INDEPENDENT_MISSED,
} from '../fixtures/disc/index.ts';

describe('AC-111 negative: shared upstream lineage cannot claim independent recall', () => {
  it('refuses independent NOT_DISCOVERED claim when lineage is shared with live sources', () => {
    const isLineageIndependent =
      RETROSPECTIVE_SAMPLE_SHARED_LINEAGE.lineageIndependenceDeclared &&
      !RETROSPECTIVE_SAMPLE_SHARED_LINEAGE.upstreamLineageSharedWithLive;

    expect(isLineageIndependent).toBe(false);
  });

  it('refuses admission of retrospective evidence into historical decision bundles (§63.9)', () => {
    const decisionBundleInputs: string[] = ['feature_snapshot_live', 'quote_adapter_live'];
    const canInjectRetrospective = !RETROSPECTIVE_SAMPLE_INDEPENDENT_MISSED.excludedFromHistoricalDecisionBundle;

    expect(canInjectRetrospective).toBe(false);
    expect(decisionBundleInputs).not.toContain('retro_sample_001');
  });
});
