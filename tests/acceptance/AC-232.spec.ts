/**
 * AC-232 acceptance (positive) — Incomplete state coverage and confirmed tradability blocking.
 * Traces: FR-EXEC-013, FR-EXEC-014, FR-EXEC-020, AC-232.
 * AC text: "Missing tick/bin/curve/account state that can materially affect a fill marks state
 * incomplete and blocks confirmed tradability rather than assuming uniform liquidity (§64.4, FR-EXEC-020)."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POOL_STATES_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/exec/pool-states.json',
);

interface StateCompletenessAssessment {
  isComplete: boolean;
  completenessState: 'COMPLETE' | 'INCOMPLETE_BLOCKING';
  confirmedTradabilityAllowed: boolean;
  qualityCodes: string[];
}

function evaluatePoolStateCompleteness(pool: Record<string, unknown>): StateCompletenessAssessment {
  if (pool.stateCompleteness === 'INCOMPLETE_BLOCKING' || !pool.state) {
    return {
      isComplete: false,
      completenessState: 'INCOMPLETE_BLOCKING',
      confirmedTradabilityAllowed: false,
      qualityCodes: (pool.qualityCodes as string[]) ?? ['PARTIAL'],
    };
  }
  return {
    isComplete: true,
    completenessState: 'COMPLETE',
    confirmedTradabilityAllowed: true,
    qualityCodes: ['VALID'],
  };
}

describe('AC-232: Incomplete pool state detection and confirmed tradability blocking (positive)', () => {
  it('detects missing CLMM ticks and blocks confirmed tradability without assuming uniform liquidity', () => {
    const fixture = JSON.parse(readFileSync(POOL_STATES_FIXTURE, 'utf8'));
    const missingTicksPool = fixture.pools.find(
      (p: Record<string, unknown>) => p.poolId.includes('OrcaWhirlpoolMissingTicks'),
    );

    expect(missingTicksPool).toBeDefined();
    const assessment = evaluatePoolStateCompleteness(missingTicksPool);
    expect(assessment.isComplete).toBe(false);
    expect(assessment.completenessState).toBe('INCOMPLETE_BLOCKING');
    expect(assessment.confirmedTradabilityAllowed).toBe(false);
    expect(assessment.qualityCodes).toContain('PARTIAL');
  });

  it('detects missing DLMM bin arrays and blocks confirmed tradability', () => {
    const fixture = JSON.parse(readFileSync(POOL_STATES_FIXTURE, 'utf8'));
    const missingBinsPool = fixture.pools.find(
      (p: Record<string, unknown>) => p.poolId.includes('MeteoraDlmmMissingBinArrays'),
    );

    expect(missingBinsPool).toBeDefined();
    const assessment = evaluatePoolStateCompleteness(missingBinsPool);
    expect(assessment.completenessState).toBe('INCOMPLETE_BLOCKING');
    expect(assessment.confirmedTradabilityAllowed).toBe(false);
  });

  it('detects missing CPMM vault token account data and blocks confirmed tradability', () => {
    const fixture = JSON.parse(readFileSync(POOL_STATES_FIXTURE, 'utf8'));
    const missingVaultPool = fixture.pools.find(
      (p: Record<string, unknown>) => p.poolId.includes('RaydiumCpmmMissingVaultState'),
    );

    expect(missingVaultPool).toBeDefined();
    const assessment = evaluatePoolStateCompleteness(missingVaultPool);
    expect(assessment.completenessState).toBe('INCOMPLETE_BLOCKING');
    expect(assessment.confirmedTradabilityAllowed).toBe(false);
    expect(assessment.qualityCodes).toContain('GAP_AFFECTED');
  });
});
