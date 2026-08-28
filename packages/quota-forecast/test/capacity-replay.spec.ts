/**
 * 30-day capacity replay and stress validation units (FR-COST-006, FR-COST-009, FR-COST-011..016, AC-227, AC-228, AC-229).
 *
 * Asserts:
 * - 30-day expected + stress replay includes all 9 dimension families:
 *   1. provider credits/rates
 *   2. streamed bytes
 *   3. model tokens
 *   4. workflow steps
 *   5. database/object growth
 *   6. egress
 *   7. retries
 *   8. notifications
 *   9. reserves
 * - Blocks activation when any verified ceiling is exceeded in expected or stress replay.
 * - Deterministic replay (same input contract -> identical replay result).
 */
import { describe, expect, it } from 'bun:test';

const SAMPLE_CONTRACT = {
  contractId: 'scc-replay-001',
  version: '1.0.0',
  horizonDays: 30,
  candidateLoad: {
    newAssetsPerDayExpected: 100,
    newAssetsPerDayStress: 500,
  },
  providerEnvelope: [
    {
      operationId: 'helius:raw_asset_query',
      callsExpected: 15000,
      callsStress: 45000,
      quotaUnitsExpected: 0,
      quotaUnitsStress: 0,
      streamedBytesExpected: 5000000000,
      streamedBytesStress: 15000000000,
      retryAllowance: 3,
    },
  ],
  systemEnvelope: {
    modelInputTokens: 1000000,
    modelOutputTokens: 200000,
    modelSpendUsd: 5.0,
    workflowSteps: 25000,
    schedulerMessages: 50000,
    databaseReads: 100000,
    databaseWrites: 20000,
    databaseStorageBytes: 2000000000,
    objectOperations: 5000,
    objectStorageBytes: 10000000000,
    egressBytes: 1000000000,
    notificationSends: 500,
  },
  reserves: {
    risk_monitoring: 0.2,
    alert_verification: 0.15,
  },
  minimumHeadroomFraction: 0.2,
  result: 'PASS',
};

describe('capacity-replay 30-day stress simulations (FR-COST-009, AC-227)', () => {
  it('enumerates all 9 dimension families in 30-day expected and stress simulations', async () => {
    let ReplayModule: Record<string, unknown>;
    try {
      ReplayModule = (await import('../src/capacity-replay.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('CAPACITY_REPLAY_NOT_IMPLEMENTED: src/capacity-replay.ts missing');
    }

    const runCapacityReplay = ReplayModule.runCapacityReplay as (contract: unknown) => {
      dimensionsCovered: string[];
      headroomVerified: boolean;
      activationPermitted: boolean;
    };

    const result = runCapacityReplay(SAMPLE_CONTRACT);
    expect(result.dimensionsCovered).toContain('CREDITS_AND_RATES');
    expect(result.dimensionsCovered).toContain('STREAMED_BYTES');
    expect(result.dimensionsCovered).toContain('MODEL_TOKENS');
    expect(result.dimensionsCovered).toContain('WORKFLOW_STEPS');
    expect(result.dimensionsCovered).toContain('DATABASE_OBJECT_STORAGE');
    expect(result.dimensionsCovered).toContain('EGRESS_BYTES');
    expect(result.dimensionsCovered).toContain('RETRY_ALLOWANCE');
    expect(result.dimensionsCovered).toContain('NOTIFICATION_SENDS');
    expect(result.dimensionsCovered).toContain('PROTECTED_RESERVES');
    expect(result.activationPermitted).toBe(true);
  });

  it('blocks activation when stress consumption exceeds hard ceiling or violates headroom', async () => {
    let ReplayModule: Record<string, unknown>;
    try {
      ReplayModule = (await import('../src/capacity-replay.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('CAPACITY_REPLAY_NOT_IMPLEMENTED: src/capacity-replay.ts missing');
    }

    const runCapacityReplay = ReplayModule.runCapacityReplay as (contract: unknown) => {
      activationPermitted: boolean;
      violations: string[];
    };

    const failingContract = {
      ...SAMPLE_CONTRACT,
      systemEnvelope: {
        ...SAMPLE_CONTRACT.systemEnvelope,
        modelSpendUsd: 10000.0, // Exceeds budget
      },
    };

    const result = runCapacityReplay(failingContract);
    expect(result.activationPermitted).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('produces identical deterministic replay outcomes across repeated executions', async () => {
    let ReplayModule: Record<string, unknown>;
    try {
      ReplayModule = (await import('../src/capacity-replay.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('CAPACITY_REPLAY_NOT_IMPLEMENTED: src/capacity-replay.ts missing');
    }

    const runCapacityReplay = ReplayModule.runCapacityReplay as (contract: unknown) => unknown;

    const run1 = runCapacityReplay(SAMPLE_CONTRACT);
    const run2 = runCapacityReplay(SAMPLE_CONTRACT);

    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});
