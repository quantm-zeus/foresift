/**
 * Claim-scope completeness (FR-OBJ-007): every objective or performance
 * claim identifies the exact supported population, profile, policy,
 * execution scenario, delay distribution, calendar interval, market
 * regimes, capability state, sample size, cluster effective sample size,
 * and uncertainty method.
 *
 * Eleven-for-eleven or refusal: an incomplete scope refuses the
 * performance view. Validated scopes are frozen before rendering.
 */
import {
  ALL_INTERVAL_METHODS,
  ObjError,
  ObjErrorCode,
  claimScopeComplete,
  claimScopeMissing,
  frozenRecordImmutable,
  type ClaimScopeField,
} from '@foresift/domain';

/** Performance claim scope with native field types. */
export interface PerformanceClaimScope {
  readonly supportedPopulation: string;
  readonly profile: string;
  readonly policy: string;
  readonly executionScenario: string;
  readonly delayDistribution: string;
  readonly calendarInterval: string;
  readonly marketRegimes: readonly string[];
  readonly capabilityState: string;
  readonly sampleSize: number;
  readonly clusterEffectiveSampleSize: number;
  readonly uncertaintyMethod: string;
}

/** Validated, frozen claim scope ready for the performance view. */
export interface ValidatedClaimScope {
  readonly runId: string;
  readonly fields: Readonly<Record<ClaimScopeField, string>>;
}

function assertPositiveInt(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ObjError(ObjErrorCode.OBJ_CLAIM_SCOPE_INCOMPLETE, 'claim scope count must be a positive integer', {
      field,
    });
}

/**
 * Validate eleven-for-eleven completeness and freeze the normalized
 * scope. Counts normalize to decimal strings; regimes join
 * deterministically. Any gap refuses the view.
 */
export function validateClaimScope(runId: string, scope: PerformanceClaimScope): ValidatedClaimScope {
  if (runId.length === 0)
    throw new ObjError(ObjErrorCode.OBJ_DIMENSION_UNKNOWN, 'claim scope requires a run id', {});
  assertPositiveInt(scope.sampleSize, 'SAMPLE_SIZE');
  if (!Number.isFinite(scope.clusterEffectiveSampleSize) || scope.clusterEffectiveSampleSize <= 0)
    throw new ObjError(ObjErrorCode.OBJ_CLAIM_SCOPE_INCOMPLETE, 'claim scope cluster ESS must be positive', {
      field: 'CLUSTER_EFFECTIVE_SAMPLE_SIZE',
    });
  if (scope.clusterEffectiveSampleSize > scope.sampleSize)
    throw new ObjError(ObjErrorCode.OBJ_CLAIM_SCOPE_INCOMPLETE, 'claim scope cluster ESS cannot exceed sample size', {
      field: 'CLUSTER_EFFECTIVE_SAMPLE_SIZE',
    });
  if (!(ALL_INTERVAL_METHODS as readonly string[]).includes(scope.uncertaintyMethod))
    throw new ObjError(ObjErrorCode.OBJ_CLAIM_FIELD_UNKNOWN, 'claim scope requires an eval-proven uncertainty method', {
      field: 'UNCERTAINTY_METHOD',
    });
  const fields = {
    SUPPORTED_POPULATION: scope.supportedPopulation,
    PROFILE: scope.profile,
    POLICY: scope.policy,
    EXECUTION_SCENARIO: scope.executionScenario,
    DELAY_DISTRIBUTION: scope.delayDistribution,
    CALENDAR_INTERVAL: scope.calendarInterval,
    MARKET_REGIMES: [...scope.marketRegimes].sort().join(','),
    CAPABILITY_STATE: scope.capabilityState,
    SAMPLE_SIZE: String(scope.sampleSize),
    CLUSTER_EFFECTIVE_SAMPLE_SIZE: String(scope.clusterEffectiveSampleSize),
    UNCERTAINTY_METHOD: scope.uncertaintyMethod,
  } as Readonly<Record<ClaimScopeField, string>>;
  const missing = claimScopeMissing(fields);
  if (missing.length > 0 || scope.marketRegimes.length === 0) {
    const absent = scope.marketRegimes.length === 0 ? ['MARKET_REGIMES'] : [];
    throw new ObjError(ObjErrorCode.OBJ_CLAIM_SCOPE_INCOMPLETE, 'claim scope is incomplete', {
      missing: [...missing, ...absent].join(','),
    });
  }
  claimScopeComplete(fields);
  return frozenRecordImmutable({ runId, fields });
}
