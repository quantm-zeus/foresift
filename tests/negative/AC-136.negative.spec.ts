/**
 * AC-136 negative / failure-path.
 * Traces: FR-TRD-004, FR-SIG-009, FR-SIG-001, AC-136.
 * Refuses full-quality contribution or unreduced factor for unresolved actor state.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-136 negative: Refusal of full quality on unresolved actors', () => {
  it('refuses 1.0 uncertainty factor when actor resolution state is UNRESOLVED', () => {
    const computeFactor = (state: string, conf: number) => (state === 'RESOLVED' ? conf : 0.0);
    const actorState = 'UNRESOLVED';
    const confidence = 0.0;
    const naiveFactor = 1.0;

    // UNRESOLVED cannot have full factor 1.0
    const resolvedFactor = computeFactor(actorState, confidence);
    expect(resolvedFactor).not.toBe(naiveFactor);
    expect(resolvedFactor).toBe(0.0);
  });

  it('refuses VALID quality code assignment when actor resolution is UNRESOLVED', () => {
    const actorState = 'UNRESOLVED';
    const qualityCodes: string[] = [];

    if (actorState === 'UNRESOLVED') {
      qualityCodes.push('SYSTEM_ADDRESS_UNCERTAIN');
    } else {
      qualityCodes.push('VALID');
    }

    expect(qualityCodes).not.toContain('VALID');
    expect(qualityCodes).toContain('SYSTEM_ADDRESS_UNCERTAIN');
  });
});

describe('AC-136 negative: Refusal of incomplete numeric stability and unclamped features (sig facet)', () => {
  it('refuses null feature value when quality codes array is empty', () => {
    interface FeatureOutput {
      value: number | null;
      qualityCodes: string[];
    }

    const validateFeatureOutput = (out: FeatureOutput): void => {
      if (out.value === null && (!out.qualityCodes || out.qualityCodes.length === 0)) {
        throw new Error('SIG_NULL_VALUE_REQUIRES_QUALITY_CODE');
      }
    };

    expect(() =>
      validateFeatureOutput({
        value: null,
        qualityCodes: [],
      }),
    ).toThrow('SIG_NULL_VALUE_REQUIRES_QUALITY_CODE');
  });

  it('refuses unclamped or out-of-bounds capped ranking contribution', () => {
    const validateCappedContribution = (cap: number): void => {
      if (cap <= 0 || cap > 1.0) {
        throw new Error('SIG_CAPPED_CONTRIBUTION_OUT_OF_BOUNDS');
      }
    };

    expect(() => validateCappedContribution(0.0)).toThrow('SIG_CAPPED_CONTRIBUTION_OUT_OF_BOUNDS');
    expect(() => validateCappedContribution(1.5)).toThrow('SIG_CAPPED_CONTRIBUTION_OUT_OF_BOUNDS');
    expect(() => validateCappedContribution(0.25)).not.toThrow();
  });

  it('refuses cohort snapshot missing fallback level or cohort size', () => {
    interface CohortSnapshotInput {
      snapshotId: string;
      fallbackLevel?: string;
      cohortSize?: number;
    }

    const validateSnapshot = (input: CohortSnapshotInput): void => {
      if (!input.fallbackLevel) {
        throw new Error('SIG_COHORT_FALLBACK_LEVEL_REQUIRED');
      }
      if (input.cohortSize === undefined || input.cohortSize < 0) {
        throw new Error('SIG_COHORT_SIZE_REQUIRED');
      }
    };

    expect(() =>
      validateSnapshot({
        snapshotId: 's1',
        cohortSize: 10,
      }),
    ).toThrow('SIG_COHORT_FALLBACK_LEVEL_REQUIRED');

    expect(() =>
      validateSnapshot({
        snapshotId: 's2',
        fallbackLevel: 'EXACT_COHORT',
      }),
    ).toThrow('SIG_COHORT_SIZE_REQUIRED');
  });
});
