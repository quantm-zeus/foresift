/**
 * Canonical containment/rollback fixtures (T033, FR-PROD-002, AC-278/279;
 * PRD §69.11/§69.12).
 *
 * Inert typed inputs for `containForFailedGate` and `rollbackToApproved`: a
 * specific exact scope plus wildcard candidates (so the SMALLEST scope is
 * chosen), and a rollback to a previously approved immutable artifact set.
 */
import type {
  ContainForFailedGateInput,
  ContainmentScopeCandidate,
  RollbackToApprovedInput,
} from '@foresift/capability-registry';
import { PROD_FIXTURE_HASH_A, PROD_FIXTURE_NOW } from './gate-inputs.ts';

/** The exact, fully-specific scope a failed gate affects. */
export const PROD_CONTAINMENT_SPECIFIC_CANDIDATE: ContainmentScopeCandidate = {
  moduleId: 'module-prod-specific',
  scope: {
    profile_version: 'profile-v1',
    policy_version: 'policy-v1',
    regime_scope: 'regime-v1',
    execution_scenario: 'scenario-v1',
    delay_policy: 'delay-v1',
    population_claim: 'population-v1',
    requires_proven: true,
  },
};

/** A wider wildcard scope that must never be contained when a smaller one exists. */
export const PROD_CONTAINMENT_WILDCARD_CANDIDATE: ContainmentScopeCandidate = {
  moduleId: 'module-prod-wildcard',
  scope: {
    profile_version: 'profile-v1',
    policy_version: 'policy-v1',
    regime_scope: '*',
    execution_scenario: '*',
    delay_policy: '*',
    population_claim: '*',
    requires_proven: true,
  },
};

export const PROD_CONTAINMENT_CANDIDATES: readonly ContainmentScopeCandidate[] = [
  PROD_CONTAINMENT_WILDCARD_CANDIDATE,
  PROD_CONTAINMENT_SPECIFIC_CANDIDATE,
];

/** A security-gate failure that must DISABLE the smallest affected scope. */
export const PROD_CONTAIN_FOR_FAILED_GATE: ContainForFailedGateInput = {
  criticalGate: 'SECURITY',
  affectedScopes: PROD_CONTAINMENT_CANDIDATES,
  reason: 'security gate failed: suspected cross-tenant leakage',
  at: PROD_FIXTURE_NOW,
  containmentId: 'containment-prod-security-1',
};

/** A capacity-gate failure that must DEGRADE (never disable) the scope. */
export const PROD_CONTAIN_FOR_CAPACITY_GATE: ContainForFailedGateInput = {
  ...PROD_CONTAIN_FOR_FAILED_GATE,
  criticalGate: 'CAPACITY',
  reason: 'capacity contract breached under sustained load',
  containmentId: 'containment-prod-capacity-1',
};

/** A rollback that restores a previously approved immutable artifact set. */
export const PROD_ROLLBACK_FIXTURE: RollbackToApprovedInput = {
  moduleId: 'module-prod-specific',
  scope: PROD_CONTAINMENT_SPECIFIC_CANDIDATE.scope,
  restoredArtifactSetHash: PROD_FIXTURE_HASH_A,
  priorActivationEventRef: 'activation-prod-prior',
  newActivationEventRef: 'activation-prod-rollback',
  candidateReevaluationRef: 'reevaluation-prod-1',
  at: PROD_FIXTURE_NOW,
  reason: 'rollback to the last approved artifact set after calibration drift',
  rollbackId: 'rollback-prod-1',
};
