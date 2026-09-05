/**
 * AC-127 acceptance (positive) — stress scenario enforcement and frozen replay reproduction (FR-EXEC-010, FR-EXEC-012, FR-EXEC-017).
 * Traces: FR-EXEC-010, FR-EXEC-012, FR-EXEC-017, AC-127.
 * AC text: "A candidate profitable only under the optimistic case fails a profile requiring
 * the conservative stress scenario, and stress assumptions reproduce in frozen replay."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('AC-127 acceptance (positive): conservative stress scenario requirement and frozen replay reproduction', () => {
  it('fails optimistic-only candidates under conservative profile and reproduces frozen replay', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/stress-cases.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    const optimisticFragile = fixture.stressMatrixCandidates.find(
      (c: Record<string, unknown>) => c.candidateId === 'cand_optimistic_only_fragile',
    );
    const robust = fixture.stressMatrixCandidates.find(
      (c: Record<string, unknown>) => c.candidateId === 'cand_robust_high_conviction',
    );

    // Optimistic candidate passes BASE_CASE but fails conservative stress
    expect(optimisticFragile.scenarioResults.BASE_CASE.tradableOutcome).toBe('TRADABLE_SUCCESS');
    expect(
      optimisticFragile.scenarioResults.CONSERVATIVE_LATENCY_ADVERSE_SELECTION.tradableOutcome,
    ).toBe('TRADABLE_FAILURE');
    expect(optimisticFragile.conservativePass).toBe(false);
    expect(optimisticFragile.confirmedOpportunityPermitted).toBe(false);

    // Robust candidate passes all
    expect(robust.conservativePass).toBe(true);
    expect(robust.confirmedOpportunityPermitted).toBe(true);

    // Frozen replay test vector
    const replayVector = fixture.frozenReplayVectors[0];
    expect(replayVector.assumptionHash.startsWith('sha256:')).toBe(true);
    expect(replayVector.expectedOutcome).toBe('TRADABLE_SUCCESS');
    expect(replayVector.isDeterministic).toBe(true);
  });
});
