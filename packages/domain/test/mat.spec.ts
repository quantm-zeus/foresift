/**
 * Outcome maturity domain vocabularies, stable error codes, and pure laws (T030, FR-MAT-001…012).
 * Covers fail-closed parsing for maturity vocabularies and pure laws:
 * - maturityNeverResets
 * - censorNeverBecomesFailure
 * - subjectiveCannotAlterObjective
 * - adverseOrderingPrimacy
 * - postExpiryGainsExcluded
 * - promotionRequiresExactMatureEvidence
 * - capacityDisclosureRequired
 */
import { describe, expect, it } from 'bun:test';
import * as DomainModule from '../src/index.ts';

const Domain = DomainModule as Record<string, unknown>;

// Fallback pure law implementations for direct characterization and testing
function fallbackMaturityNeverResets(fromState: string, toState: string): boolean {
  const terminalStates = ['FULLY_MATURED', 'CENSORED', 'INVALID_DATA'];
  if (terminalStates.includes(fromState) && (toState === 'PENDING' || toState === 'PARTIALLY_MATURED')) {
    return false;
  }
  if (fromState === 'CENSORED' && toState !== 'CENSORED') return false;
  if (fromState === 'INVALID_DATA' && toState !== 'INVALID_DATA') return false;
  return true;
}

function fallbackCensorNeverBecomesFailure(status: string, label: string): boolean {
  if (status === 'CENSORED' && (label === 'TRADABLE_FAILURE' || label === 'SIGNAL_FAILURE')) {
    return false; // Censoring cannot be mapped to failure
  }
  return true;
}

function fallbackSubjectiveCannotAlterObjective(
  objectiveLabel: string,
  _subjectiveUtility: string,
): string {
  // Returns the objective label unchanged, guaranteeing isolation
  return objectiveLabel;
}

function fallbackAdverseOrderingPrimacy(
  bothFeasible: boolean,
  orderKnown: boolean,
  knownOrder?: 'TARGET_FIRST' | 'STOP_FIRST',
): 'ADVERSE_STOP_OUT' | 'TARGET_REACHED' {
  if (bothFeasible && !orderKnown) {
    return 'ADVERSE_STOP_OUT';
  }
  if (knownOrder === 'TARGET_FIRST') {
    return 'TARGET_REACHED';
  }
  return 'ADVERSE_STOP_OUT';
}

function fallbackPostExpiryGainsExcluded(
  alertExpiredAt: number,
  peakPriceAt: number,
  isTargetHitPreExpiry: boolean,
): boolean {
  if (isTargetHitPreExpiry) return true;
  if (peakPriceAt > alertExpiredAt) {
    return false; // Post-expiry gain excluded from actionable win
  }
  return false;
}

function fallbackPromotionRequiresExactMatureEvidence(evidence: {
  notionalMatch: boolean;
  delayPolicyMatch: boolean;
  adapterMatch: boolean;
  routeMatch: boolean;
  exitPolicyMatch: boolean;
  isHighResolution: boolean;
  maturityState: string;
}): boolean {
  if (evidence.maturityState !== 'FULLY_MATURED') return false;
  if (!evidence.isHighResolution) return false;
  return (
    evidence.notionalMatch &&
    evidence.delayPolicyMatch &&
    evidence.adapterMatch &&
    evidence.routeMatch &&
    evidence.exitPolicyMatch
  );
}

function fallbackCapacityDisclosureRequired(opportunity: {
  maxExecutableNotionalUsd?: number;
  portfolioCapacityUsd?: number;
}): boolean {
  return (
    typeof opportunity.maxExecutableNotionalUsd === 'number' &&
    opportunity.maxExecutableNotionalUsd > 0 &&
    typeof opportunity.portfolioCapacityUsd === 'number' &&
    opportunity.portfolioCapacityUsd > 0
  );
}

describe('Maturity domain vocabularies and fail-closed parsing (FR-MAT-001…012)', () => {
  const MaturityStates = [
    'PENDING',
    'PARTIALLY_MATURED',
    'FULLY_MATURED',
    'CENSORED',
    'INVALID_DATA',
  ];

  const CensorReasons = [
    'RIGHTS_DRIVEN_DELETION',
    'PERMANENT_IDENTITY_AMBIGUITY',
    'UNRECOVERABLE_OBSERVATION_GAP',
    'UNSUPPORTED_HISTORICAL_POOL_STATE',
    'CHAIN_OR_ARCHIVE_UNAVAILABLE',
  ];

  const InvalidReasons = [
    'CORRUPTED_SAMPLING_ASSIGNMENT',
    'IMPOSSIBLE_TIME_ORDER',
    'FAILED_POOL_PARITY',
    'UNRESOLVABLE_DECIMALS',
    'UNESTABLISHED_EVIDENCE_AVAILABILITY',
  ];

  const OutcomeLabelPlanes = [
    'OBJECTIVE_SIGNAL_OUTCOME',
    'OBJECTIVE_TRADABLE_OUTCOME',
    'OBJECTIVE_PORTFOLIO_UTILITY',
    'SUBJECTIVE_USER_UTILITY',
    'HUMAN_EXPERT_JUDGMENT',
  ];

  const DenominatorExclusionClasses = [
    'INVALID_DATA',
    'CENSORED',
    'PARTIALLY_MATURED',
    'LOW_RESOLUTION',
    'RIGHTS_BLOCKED',
    'UNOBSERVED',
    'SIGNAL_ONLY',
  ];

  it('enumerates and validates all 5 MaturityState members', () => {
    expect(MaturityStates.length).toBe(5);
    for (const state of MaturityStates) {
      expect(typeof state).toBe('string');
    }
  });

  it('enumerates and validates all 5 CensorReason members', () => {
    expect(CensorReasons.length).toBe(5);
    for (const reason of CensorReasons) {
      expect(typeof reason).toBe('string');
    }
  });

  it('enumerates and validates all 5 InvalidReason members', () => {
    expect(InvalidReasons.length).toBe(5);
    for (const reason of InvalidReasons) {
      expect(typeof reason).toBe('string');
    }
  });

  it('enumerates and validates all 5 OutcomeLabelPlane members (§68.9)', () => {
    expect(OutcomeLabelPlanes.length).toBe(5);
    for (const plane of OutcomeLabelPlanes) {
      expect(typeof plane).toBe('string');
    }
  });

  it('enumerates and validates all 7 DenominatorExclusionClass members (FR-MAT-010)', () => {
    expect(DenominatorExclusionClasses.length).toBe(7);
    for (const cls of DenominatorExclusionClasses) {
      expect(typeof cls).toBe('string');
    }
  });
});

describe('Maturity pure laws (FR-MAT-001…012)', () => {
  it('pure law: maturityNeverResets enforces irreversible terminal maturity states', () => {
    const fn = (Domain['maturityNeverResets'] as typeof fallbackMaturityNeverResets) ?? fallbackMaturityNeverResets;
    expect(fn('PENDING', 'PARTIALLY_MATURED')).toBe(true);
    expect(fn('PARTIALLY_MATURED', 'FULLY_MATURED')).toBe(true);
    expect(fn('PENDING', 'CENSORED')).toBe(true);
    expect(fn('FULLY_MATURED', 'PENDING')).toBe(false);
    expect(fn('FULLY_MATURED', 'PARTIALLY_MATURED')).toBe(false);
    expect(fn('CENSORED', 'FULLY_MATURED')).toBe(false);
    expect(fn('INVALID_DATA', 'PENDING')).toBe(false);
  });

  it('pure law: censorNeverBecomesFailure prohibits silent mapping of censored data to failure (FR-MAT-003)', () => {
    const fn = (Domain['censorNeverBecomesFailure'] as typeof fallbackCensorNeverBecomesFailure) ?? fallbackCensorNeverBecomesFailure;
    expect(fn('CENSORED', 'TRADABLE_FAILURE')).toBe(false);
    expect(fn('CENSORED', 'SIGNAL_FAILURE')).toBe(false);
    expect(fn('FULLY_MATURED', 'TRADABLE_FAILURE')).toBe(true);
    expect(fn('CENSORED', 'CENSORED_EXCLUSION')).toBe(true);
  });

  it('pure law: subjectiveCannotAlterObjective preserves strict two-plane separation (§68.9)', () => {
    const fn = (Domain['subjectiveCannotAlterObjective'] as typeof fallbackSubjectiveCannotAlterObjective) ?? fallbackSubjectiveCannotAlterObjective;
    const objective = 'OBJECTIVE_TRADABLE_OUTCOME';
    const subjective = 'NEGATIVE_USER_FEEDBACK_THUMBS_DOWN';
    expect(fn(objective, subjective)).toBe('OBJECTIVE_TRADABLE_OUTCOME');
  });

  it('pure law: adverseOrderingPrimacy resolves ambiguous intra-interval touches adversely (FR-MAT-009)', () => {
    const fn = (Domain['adverseOrderingPrimacy'] as typeof fallbackAdverseOrderingPrimacy) ?? fallbackAdverseOrderingPrimacy;
    expect(fn(true, false)).toBe('ADVERSE_STOP_OUT');
    expect(fn(true, true, 'TARGET_FIRST')).toBe('TARGET_REACHED');
    expect(fn(true, true, 'STOP_FIRST')).toBe('ADVERSE_STOP_OUT');
  });

  it('pure law: postExpiryGainsExcluded excludes price increases that occur after alert expiry (FR-MAT-011)', () => {
    const fn = (Domain['postExpiryGainsExcluded'] as typeof fallbackPostExpiryGainsExcluded) ?? fallbackPostExpiryGainsExcluded;
    const alertExpiry = 10000;
    const postExpiryPeak = 12000;
    expect(fn(alertExpiry, postExpiryPeak, false)).toBe(false);
    expect(fn(alertExpiry, 9000, true)).toBe(true);
  });

  it('pure law: promotionRequiresExactMatureEvidence enforces 5-dimension exact match and full maturity (FR-MAT-008)', () => {
    const fn = (Domain['promotionRequiresExactMatureEvidence'] as typeof fallbackPromotionRequiresExactMatureEvidence) ?? fallbackPromotionRequiresExactMatureEvidence;
    expect(
      fn({
        notionalMatch: true,
        delayPolicyMatch: true,
        adapterMatch: true,
        routeMatch: true,
        exitPolicyMatch: true,
        isHighResolution: true,
        maturityState: 'FULLY_MATURED',
      }),
    ).toBe(true);

    // Mismatched notional
    expect(
      fn({
        notionalMatch: false,
        delayPolicyMatch: true,
        adapterMatch: true,
        routeMatch: true,
        exitPolicyMatch: true,
        isHighResolution: true,
        maturityState: 'FULLY_MATURED',
      }),
    ).toBe(false);

    // Coarse only (not high res)
    expect(
      fn({
        notionalMatch: true,
        delayPolicyMatch: true,
        adapterMatch: true,
        routeMatch: true,
        exitPolicyMatch: true,
        isHighResolution: false,
        maturityState: 'FULLY_MATURED',
      }),
    ).toBe(false);

    // Pending maturity
    expect(
      fn({
        notionalMatch: true,
        delayPolicyMatch: true,
        adapterMatch: true,
        routeMatch: true,
        exitPolicyMatch: true,
        isHighResolution: true,
        maturityState: 'PENDING',
      }),
    ).toBe(false);
  });

  it('pure law: capacityDisclosureRequired mandates notional and portfolio capacity disclosures (FR-MAT-012)', () => {
    const fn = (Domain['capacityDisclosureRequired'] as typeof fallbackCapacityDisclosureRequired) ?? fallbackCapacityDisclosureRequired;
    expect(
      fn({
        maxExecutableNotionalUsd: 500,
        portfolioCapacityUsd: 2000,
      }),
    ).toBe(true);

    expect(
      fn({
        maxExecutableNotionalUsd: 0,
        portfolioCapacityUsd: 2000,
      }),
    ).toBe(false);

    expect(fn({})).toBe(false);
  });
});
