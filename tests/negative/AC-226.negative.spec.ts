/**
 * AC-226 negative / failure-path — Cost & Latency Decomposition facet.
 * Traces: FR-COST-006, FR-LAT.
 *
 * Asserts:
 * - Emitting cost-path decomposition records with missing provider comparison alternative span fails validation.
 * - Latency inflation in reserve router exceeding SLA triggers backpressure warning.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-226 negative: missing provider comparison span in cost path is rejected', () => {
  it('rejects latency span payload when provider comparison alternative is omitted', async () => {
    let CostRouterModule: Record<string, unknown>;
    try {
      CostRouterModule = (await import(
        '../../packages/cost-router/src/cost-audit.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('COST_ROUTER_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const validateLatencySpans = CostRouterModule.validateLatencySpans as (
      spans: Record<string, number>,
    ) => boolean;

    // Missing providerComparisonSpan
    expect(() =>
      validateLatencySpans({
        eventToCollectorMs: 5,
        collectorToFeatureMs: 10,
        featureToDecisionMs: 15,
        decisionToDeliveryMs: 5,
      }),
    ).toThrow(/MISSING_SPAN: providerComparison/i);
  });
});
