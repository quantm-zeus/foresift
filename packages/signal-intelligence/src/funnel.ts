export const FUNNEL_STAGES = [
  'FREE_DISCOVERY_UNIVERSE_ATTRIBUTION',
  'IDENTITY_VALIDATION',
  'CAPABILITY_DATA_QUALITY_GATE',
  'ELIGIBILITY_GATES',
  'ZERO_COST_COARSE_GATE',
  'CHEAP_BATCH_MONITORING_PERSISTENCE_GATE',
  'SELECTIVE_FREE_QUOTA_SECURITY_ONCHAIN_VERIFICATION',
  'ECONOMIC_TRADE_NORMALIZATION_DETERMINISTIC_SECURITY',
  'FEATURE_UPDATE',
  'REGIME_ROUTE_RESOLUTION',
  'NARRATIVE_CROSS_CHAIN_CONTEXT',
  'VECTOR_CONSTRUCTION',
  'CROWDING_OPPORTUNITY_DECAY_PRECHECK',
  'PARETO_FILTERING',
  'RESEARCH_PRIORITY_RANKING',
  'DIVERSITY_SELECTION',
  'AGENT_RESEARCH',
  'THESIS_CREATION_UPDATE_WHY_NOW',
  'EVIDENCE_VALIDATION_ROBUSTNESS_CHECKS',
  'EXECUTION_TRADABILITY_OUTCOME_PROFILE_GATE',
  'ALERT_POLICY',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const HARD_GATE_CODES = [
  'INVALID_OR_AMBIGUOUS_IDENTITY',
  'UNSUPPORTED_CHAIN_PROVIDER',
  'LIQUIDITY_BELOW_MINIMUM',
  'CRITICAL_HONEYPOT_OR_TRANSFER_RESTRICTION',
  'KNOWN_MALICIOUS_DEPLOYER',
  'UNUSABLE_CANONICAL_POOL',
  'DATA_COVERAGE_BELOW_MINIMUM',
  'PRICE_EXTENSION_BEYOND_MAXIMUM',
  'LICENSE_RESTRICTION',
  'NON_EXECUTABLE_ENTRY_OR_EXIT',
  'UNKNOWN_REQUIRED_TOKEN_2022_BEHAVIOR',
  'UNAVAILABLE_REQUIRED_CAPABILITY',
  'UNACCEPTABLY_EXTENDED_PRICE_MOVE',
] as const;
export type HardGateCode = (typeof HARD_GATE_CODES)[number];

export interface HardGateProfile {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly minimumLiquidityUsd: number;
  readonly minimumDataCoverage: number;
  readonly maximumPriceExtension: number;
  readonly token2022BehaviorRequired: boolean;
}

export interface HardGateFacts {
  readonly identityValidAndUnambiguous: boolean;
  readonly chainProviderSupported: boolean;
  readonly liquidityUsd: number | null;
  readonly criticalHoneypotOrTransferRestriction: boolean;
  readonly knownMaliciousDeployer: boolean;
  readonly canonicalPoolUsable: boolean;
  readonly dataCoverage: number | null;
  readonly priceExtension: number | null;
  readonly licensePermitsRequiredUse: boolean;
  readonly entryExecutable: boolean;
  readonly exitExecutable: boolean;
  readonly token2022BehaviorKnown: boolean;
  readonly requiredCapabilityAvailable: boolean;
  readonly approvedCapabilityFallbackAvailable: boolean;
  readonly appearedOnlyAfterUnacceptablyExtendedMove: boolean;
}

export interface HardGateEvaluation {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly passed: boolean;
  readonly gateCodes: readonly HardGateCode[];
}

function finiteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${field} must be non-negative`);
}

export function evaluateHardGates(
  facts: HardGateFacts,
  profile: HardGateProfile,
): HardGateEvaluation {
  if (
    profile.profileId.trim() === '' ||
    !Number.isInteger(profile.profileVersion) ||
    profile.profileVersion < 1
  ) {
    throw new RangeError('hard-gate profile identity/version is invalid');
  }
  finiteNonNegative(profile.minimumLiquidityUsd, 'minimumLiquidityUsd');
  if (
    !Number.isFinite(profile.minimumDataCoverage) ||
    profile.minimumDataCoverage < 0 ||
    profile.minimumDataCoverage > 1
  ) {
    throw new RangeError('minimumDataCoverage must lie in [0,1]');
  }
  finiteNonNegative(profile.maximumPriceExtension, 'maximumPriceExtension');
  if (facts.liquidityUsd !== null) finiteNonNegative(facts.liquidityUsd, 'liquidityUsd');
  if (
    facts.dataCoverage !== null &&
    (!Number.isFinite(facts.dataCoverage) || facts.dataCoverage < 0 || facts.dataCoverage > 1)
  ) {
    throw new RangeError('dataCoverage must lie in [0,1] or be null');
  }
  if (facts.priceExtension !== null && !Number.isFinite(facts.priceExtension)) {
    throw new RangeError('priceExtension must be finite or null');
  }
  const failures: HardGateCode[] = [];
  if (!facts.identityValidAndUnambiguous) failures.push('INVALID_OR_AMBIGUOUS_IDENTITY');
  if (!facts.chainProviderSupported) failures.push('UNSUPPORTED_CHAIN_PROVIDER');
  if (facts.liquidityUsd === null || facts.liquidityUsd < profile.minimumLiquidityUsd)
    failures.push('LIQUIDITY_BELOW_MINIMUM');
  if (facts.criticalHoneypotOrTransferRestriction)
    failures.push('CRITICAL_HONEYPOT_OR_TRANSFER_RESTRICTION');
  if (facts.knownMaliciousDeployer) failures.push('KNOWN_MALICIOUS_DEPLOYER');
  if (!facts.canonicalPoolUsable) failures.push('UNUSABLE_CANONICAL_POOL');
  if (facts.dataCoverage === null || facts.dataCoverage < profile.minimumDataCoverage)
    failures.push('DATA_COVERAGE_BELOW_MINIMUM');
  if (facts.priceExtension === null || facts.priceExtension > profile.maximumPriceExtension)
    failures.push('PRICE_EXTENSION_BEYOND_MAXIMUM');
  if (!facts.licensePermitsRequiredUse) failures.push('LICENSE_RESTRICTION');
  if (!facts.entryExecutable || !facts.exitExecutable)
    failures.push('NON_EXECUTABLE_ENTRY_OR_EXIT');
  if (profile.token2022BehaviorRequired && !facts.token2022BehaviorKnown)
    failures.push('UNKNOWN_REQUIRED_TOKEN_2022_BEHAVIOR');
  if (!facts.requiredCapabilityAvailable && !facts.approvedCapabilityFallbackAvailable)
    failures.push('UNAVAILABLE_REQUIRED_CAPABILITY');
  if (facts.appearedOnlyAfterUnacceptablyExtendedMove)
    failures.push('UNACCEPTABLY_EXTENDED_PRICE_MOVE');
  return {
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    passed: failures.length === 0,
    gateCodes: failures,
  };
}

export interface FunnelStageOutcome {
  readonly stage: FunnelStage;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly passed: boolean;
  readonly gateCode: HardGateCode | null;
}

/** One reason-coded record per failure, or one successful eligibility-stage record. */
export function hardGateStageRecords(
  evaluation: HardGateEvaluation,
): readonly FunnelStageOutcome[] {
  return evaluation.gateCodes.length === 0
    ? [{ stage: 'ELIGIBILITY_GATES', ...evaluation, gateCode: null }]
    : evaluation.gateCodes.map((gateCode) => ({
        stage: 'ELIGIBILITY_GATES',
        profileId: evaluation.profileId,
        profileVersion: evaluation.profileVersion,
        passed: false,
        gateCode,
      }));
}
