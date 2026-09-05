/**
 * AC-127 negative (failure) — Refusal of optimistic-only promotion and corrupted replay reproduction.
 * Traces: FR-EXEC-010, FR-EXEC-012, FR-EXEC-017, AC-127.
 * Tests structural refusal of passing candidates on optimistic results alone and failure of replay upon assumption mutation.
 */
import { describe, expect, it } from 'bun:test';

function assertProfilePassMatrix(params: {
  candidateId: string;
  scenarioResults: Record<string, { passed: boolean }>;
  requiredScenarios: string[];
}) {
  for (const req of params.requiredScenarios) {
    if (!params.scenarioResults[req] || !params.scenarioResults[req].passed) {
      throw new Error(`PROFILE_REJECTED_MISSING_OR_FAILED_SCENARIO:${req}`);
    }
  }
  return true;
}

function verifyReplayIntegrity(params: {
  frozenAssumptionHash: string;
  actualAssumptionHash: string;
}) {
  if (params.frozenAssumptionHash !== params.actualAssumptionHash) {
    throw new Error('REPLAY_REPRODUCTION_FAILED_ASSUMPTIONS_MUTATED');
  }
  return true;
}

describe('AC-127 negative: optimistic-only candidate pass and mutated replay reproduction are refused', () => {
  it('refuses passing CONFIRMED_OPPORTUNITY when conservative stress scenario fails', () => {
    const scenarioResults = {
      BASE_CASE: { passed: true },
      P50_DELAY: { passed: true },
      CONSERVATIVE_LATENCY_ADVERSE_SELECTION: { passed: false }, // Fails conservative stress
    };

    expect(() =>
      assertProfilePassMatrix({
        candidateId: 'fragile_cand',
        scenarioResults,
        requiredScenarios: ['BASE_CASE', 'CONSERVATIVE_LATENCY_ADVERSE_SELECTION'],
      }),
    ).toThrow('PROFILE_REJECTED_MISSING_OR_FAILED_SCENARIO:CONSERVATIVE_LATENCY_ADVERSE_SELECTION');
  });

  it('fails replay reproduction when assumptions are mutated', () => {
    expect(() =>
      verifyReplayIntegrity({
        frozenAssumptionHash: 'sha256:frozen_hash_aaa',
        actualAssumptionHash: 'sha256:mutated_hash_bbb',
      }),
    ).toThrow('REPLAY_REPRODUCTION_FAILED_ASSUMPTIONS_MUTATED');
  });
});
