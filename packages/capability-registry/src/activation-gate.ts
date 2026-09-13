/**
 * The total, ordered, fail-closed activation gate (T015, FR-PROD-001/002/
 * 004/005, AC-144/150/151/152/154/272/273/275/276/277; PRD §69.4/§69.5/
 * §69.9; plan D2).
 *
 * `evaluateActivationGate` is ONE total function over the ordered
 * `ACTIVATION_GATE_ORDER`: it walks every gate in sequence, returns `PASS`
 * only when every REQUIRED gate passes exactly once, and otherwise returns a
 * typed refusal naming the FIRST failing gate. Missing, stale, malformed, or
 * scope-mismatched inputs fail closed — never skipped. A gate that does not
 * apply to the requested `ActivationKind` returns `PASS` (skipped), so
 * operational activation is not forced to fabricate statistical evidence.
 *
 * The gate CONSUMES foreign results and never recomputes them:
 *   - gate evidence verification is `@foresift/release-conformance`
 *     `evaluateGateEvidence` (hash, signature, revocation, validity, scope);
 *   - the capacity contract is validated/activated by the authoritative
 *     capacity law `validateSustainableCapacityContract` +
 *     `isContractActivatable` (the same law `@foresift/capacity-planner`'s
 *     admission path consumes);
 *   - statistical evidence, negative controls, clustered-interval comparison,
 *     calibration maturity, and distribution/isolation/claims/rights evidence
 *     arrive as already-registered verdicts.
 *
 * Strictly read-only: the gate decides whether read-only intelligence may
 * influence an exact scope; it can never trade, custody, sign, or submit.
 */
import {
  ACTIVATION_GATE_ORDER,
  ActivationGateKind,
  ActivationGateVerdict,
  DistributionReadiness,
  ErrorCode,
  ForesiftError,
  isContractActivatable,
  parseActivationGateKind,
  parseActivationGateVerdict,
  parseDistributionReadiness,
  validateSustainableCapacityContract,
  type SustainableCapacityContract,
} from '@foresift/domain';
import {
  evaluateGateEvidence,
  type GateEvidenceFailureReason,
  type GateEvidenceRecord,
} from '@foresift/release-conformance';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import {
  activationScopeHash,
  parseModuleStateScope,
  type ModuleStateScope,
} from './module-states.ts';

// --- activation kind --------------------------------------------------------

/** Which §69 gate family the evaluation is deciding. */
export const ActivationKind = {
  /** §69.4: collection, deterministic analysis, risk monitoring, shadow research. */
  OPERATIONAL: 'OPERATIONAL',
  /** §69.5: `CONFIRMED_OPPORTUNITY` active influence for the exact scope. */
  OPPORTUNITY: 'OPPORTUNITY',
  /** §69.9: a workspace surface becomes authorized. */
  WORKSPACE: 'WORKSPACE',
  /** §69.9: a public surface becomes authorized. */
  PUBLIC: 'PUBLIC',
} as const;
export type ActivationKind = (typeof ActivationKind)[keyof typeof ActivationKind];
export const ALL_ACTIVATION_KINDS: readonly ActivationKind[] = Object.values(ActivationKind);

/** §69.9 distribution kinds that additionally require the public gate set. */
export function isDistributionActivation(kind: ActivationKind): boolean {
  return kind === ActivationKind.WORKSPACE || kind === ActivationKind.PUBLIC;
}

/**
 * The gates REQUIRED for one activation kind, in the authoritative order. The
 * returned list is always a subsequence of `ACTIVATION_GATE_ORDER`, so the
 * total function can walk the canonical order and skip the rest.
 */
export function requiredGatesForActivation(
  kind: ActivationKind,
  scope: ModuleStateScope,
): readonly ActivationGateKind[] {
  const parsedScope = parseModuleStateScope(scope);
  const operational: ActivationGateKind[] = [
    ActivationGateKind.IMPLEMENTED_PRESENT,
    ActivationGateKind.AVAILABLE_EVIDENCE,
    ActivationGateKind.VERIFIED_GATE_EVIDENCE,
    ActivationGateKind.CAPACITY_CONTRACT,
    ActivationGateKind.NO_OPEN_CONTAINMENT,
  ];
  // §69.5: PROVEN is required exactly when the exact scope specifies it.
  const provenGate: ActivationGateKind[] = parsedScope.requires_proven
    ? [ActivationGateKind.PROVEN_PRESENT]
    : [];
  const opportunity: ActivationGateKind[] = [
    ActivationGateKind.IMPLEMENTED_PRESENT,
    ActivationGateKind.AVAILABLE_EVIDENCE,
    ...provenGate,
    ActivationGateKind.STATISTICAL_EVIDENCE_SCOPE,
    ActivationGateKind.NEGATIVE_CONTROLS,
    ActivationGateKind.CLUSTERED_INTERVALS,
    ActivationGateKind.CALIBRATION_MATURITY,
    ActivationGateKind.VERIFIED_GATE_EVIDENCE,
    ActivationGateKind.CAPACITY_CONTRACT,
    ActivationGateKind.NO_OPEN_CONTAINMENT,
  ];
  switch (kind) {
    case ActivationKind.OPERATIONAL:
      return operational;
    case ActivationKind.OPPORTUNITY:
      return opportunity;
    case ActivationKind.WORKSPACE:
    case ActivationKind.PUBLIC:
      return [...opportunity, ActivationGateKind.DISTRIBUTION_EVIDENCE];
    default: {
      // Every member is handled; an impossible value fails closed.
      const exhaustive: never = kind;
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
        `unknown activation kind ${String(exhaustive)}`,
        { kind: String(kind) },
      );
    }
  }
}

// --- refusal vocabulary -----------------------------------------------------

/** Closed typed refusal reasons; every condition names its gate AND reason. */
export const ActivationGateRefusalReason = {
  MODULE_NOT_IMPLEMENTED: 'MODULE_NOT_IMPLEMENTED',
  AVAILABLE_NOT_ESTABLISHED: 'AVAILABLE_NOT_ESTABLISHED',
  AVAILABLE_EVIDENCE_MISSING: 'AVAILABLE_EVIDENCE_MISSING',
  PROVEN_REQUIRED: 'PROVEN_REQUIRED',
  STATISTICAL_EVIDENCE_MISSING: 'STATISTICAL_EVIDENCE_MISSING',
  STATISTICAL_EVIDENCE_STALE: 'STATISTICAL_EVIDENCE_STALE',
  STATISTICAL_EVIDENCE_SCOPE_MISMATCH: 'STATISTICAL_EVIDENCE_SCOPE_MISMATCH',
  STATISTICAL_EVIDENCE_AMBIGUOUS: 'STATISTICAL_EVIDENCE_AMBIGUOUS',
  NEGATIVE_CONTROL_MISSING: 'NEGATIVE_CONTROL_MISSING',
  NEGATIVE_CONTROL_FAILED: 'NEGATIVE_CONTROL_FAILED',
  CLUSTERED_INTERVALS_REQUIRED: 'CLUSTERED_INTERVALS_REQUIRED',
  CLUSTERED_INTERVALS_NOT_COMPARED: 'CLUSTERED_INTERVALS_NOT_COMPARED',
  CALIBRATION_IMMATURE: 'CALIBRATION_IMMATURE',
  DISTRIBUTION_EVIDENCE_MISSING: 'DISTRIBUTION_EVIDENCE_MISSING',
  DISTRIBUTION_NOT_AUTHORIZED: 'DISTRIBUTION_NOT_AUTHORIZED',
  RIGHTS_CHANGE_OPEN: 'RIGHTS_CHANGE_OPEN',
  GATE_EVIDENCE_MISSING: 'GATE_EVIDENCE_MISSING',
  GATE_EVIDENCE_INVALID: 'GATE_EVIDENCE_INVALID',
  CAPACITY_CONTRACT_MISSING: 'CAPACITY_CONTRACT_MISSING',
  CAPACITY_CONTRACT_INVALID: 'CAPACITY_CONTRACT_INVALID',
  CAPACITY_CONTRACT_NOT_PASS: 'CAPACITY_CONTRACT_NOT_PASS',
  CAPACITY_CONTRACT_EXPIRED: 'CAPACITY_CONTRACT_EXPIRED',
  CONTAINMENT_OPEN: 'CONTAINMENT_OPEN',
  ACTIVATION_SCOPE_INVALID: 'ACTIVATION_SCOPE_INVALID',
} as const;
export type ActivationGateRefusalReason =
  (typeof ActivationGateRefusalReason)[keyof typeof ActivationGateRefusalReason];

// --- inputs -----------------------------------------------------------------

/** The §69.3 `AVAILABLE` evidence bundle: data, rights, capability, source
 * coverage, pool adapter, cost, capacity, freshness. Missing keys fail closed. */
export interface AvailableEvidenceInput {
  readonly data: boolean;
  readonly rights: boolean;
  readonly capability: boolean;
  readonly sourceCoverage: boolean;
  readonly poolAdapter: boolean;
  readonly cost: boolean;
  readonly capacity: boolean;
  readonly freshness: boolean;
}

/** The §31/§39 mandatory negative controls (AC-150). */
export const NegativeControlKind = {
  LABEL_PERMUTATION: 'LABEL_PERMUTATION',
  FEATURE_TIME_SHIFT: 'FEATURE_TIME_SHIFT',
  SYNTHETIC_NULL_FEATURE: 'SYNTHETIC_NULL_FEATURE',
  DELAYED_PROVIDER: 'DELAYED_PROVIDER',
} as const;
export type NegativeControlKind = (typeof NegativeControlKind)[keyof typeof NegativeControlKind];
export const ALL_NEGATIVE_CONTROL_KINDS: readonly NegativeControlKind[] =
  Object.values(NegativeControlKind);

/** One registered negative-control verdict. */
export interface NegativeControlRecord {
  readonly control: NegativeControlKind;
  readonly passed: boolean;
  readonly unexplainedMaterialLift: boolean;
}

/** Calibration maturity vocabulary (AC-154 gates ranking influence). */
export const CalibrationMaturity = {
  DRAFT: 'DRAFT',
  IMMATURE: 'IMMATURE',
  MATURE: 'MATURE',
} as const;
export type CalibrationMaturity = (typeof CalibrationMaturity)[keyof typeof CalibrationMaturity];
export const ALL_CALIBRATION_MATURITIES: readonly CalibrationMaturity[] =
  Object.values(CalibrationMaturity);

/** The clustered/naive interval methods the gate recognises (AC-151). */
export const CLUSTERED_INTERVAL_METHODS = [
  'CLUSTERED_BLOCK_BOOTSTRAP',
  'CLUSTER_BOOTSTRAP',
  'RANDOMIZATION_INFERENCE',
] as const;

/**
 * A foreign-registered statistical evidence bundle for one exact scope. The
 * gate never recomputes a statistic: it matches the registered scope hash and
 * consumes the registered control/interval/calibration verdicts.
 */
export interface RegisteredStatisticalEvidence {
  readonly evidenceRef: string;
  readonly scopeHash: string;
  readonly intervalMethod: string;
  readonly clusterDefinition: string;
  readonly naiveIntervalMethod: string;
  readonly clusteredDiffersFromNaive: boolean;
  readonly negativeControls: readonly NegativeControlRecord[];
  readonly calibration: {
    readonly maturity: CalibrationMaturity;
    readonly expectedNetUtilityRankingEnabled: boolean;
    readonly regimeDrift: boolean;
  };
  readonly expiresAt: string;
}

/** §69.9 workspace/public distribution evidence (AC-272/273/275/276/277). */
export interface DistributionEvidenceInput {
  readonly distributionReadiness: DistributionReadiness;
  readonly oauthTenantIsolation: boolean;
  readonly originClientCompatibility: boolean;
  readonly dataRightsRedistribution: boolean;
  readonly privacyRetentionDeletionExport: boolean;
  readonly jurisdictionDisclosure: boolean;
  readonly claimsReview: boolean;
  readonly abuseRateLimitIncidentResponse: boolean;
  readonly supportSecurityContact: boolean;
  readonly publicSafeRedaction: boolean;
  readonly isolationFixtures: boolean;
  readonly rightsChangeBlockedPaths: readonly string[];
}

/** One open containment fact (consumed from `containment.ts`). */
export interface OpenContainmentFact {
  readonly containmentId: string;
  readonly moduleId: string;
  readonly scopeHash: string;
  readonly action: string;
}

/** The complete, fully-resolved gate input. */
export interface ActivationGateInput {
  readonly kind: ActivationKind;
  readonly scope: ModuleStateScope;
  readonly now: string;
  readonly implemented: boolean;
  readonly available: boolean;
  readonly proven: boolean;
  readonly availableEvidence: AvailableEvidenceInput | null;
  readonly registeredStatisticalEvidence: readonly RegisteredStatisticalEvidence[];
  readonly verifiedGateEvidence: {
    readonly record: GateEvidenceRecord;
    readonly pepper: string;
  } | null;
  readonly capacityContract: SustainableCapacityContract | null;
  readonly distributionEvidence: DistributionEvidenceInput | null;
  readonly openContainment: readonly OpenContainmentFact[];
  /** The activation event created when the gate passes (never reused). */
  readonly activationEventRef: string;
  readonly expiresAt: string;
  readonly evidenceRefs?: readonly string[];
}

// --- results ----------------------------------------------------------------

/** One gate's evaluation. `failingGate` is null exactly when the verdict passes. */
export interface GateConditionEvaluation {
  readonly gateKind: ActivationGateKind;
  readonly verdict: ActivationGateVerdict;
  readonly failingGate: ActivationGateKind | null;
  readonly reason: ActivationGateRefusalReason | null;
  readonly detail: string;
}

export interface ActivationGatePass {
  readonly verdict: 'PASS';
  readonly scopeHash: string;
  readonly evaluations: readonly GateConditionEvaluation[];
  readonly activationEventRef: string;
  readonly capacityContractRef: string;
  readonly evaluatedAt: string;
  readonly expiresAt: string;
  readonly evidenceRefs: readonly string[];
}

export interface ActivationGateRefusal {
  readonly verdict: 'REFUSE';
  readonly scopeHash: string;
  readonly failingGate: ActivationGateKind;
  readonly reason: ActivationGateRefusalReason;
  readonly detail: string;
  readonly evaluations: readonly GateConditionEvaluation[];
}

export type ActivationGateResult = ActivationGatePass | ActivationGateRefusal;

// --- helpers ----------------------------------------------------------------

function pass(gate: ActivationGateKind): GateConditionEvaluation {
  return {
    gateKind: gate,
    verdict: ActivationGateVerdict.PASS,
    failingGate: null,
    reason: null,
    detail: 'pass',
  };
}

function refuse(
  gate: ActivationGateKind,
  reason: ActivationGateRefusalReason,
  detail: string,
): GateConditionEvaluation {
  return {
    gateKind: gate,
    verdict: ActivationGateVerdict.REFUSE,
    failingGate: gate,
    reason,
    detail,
  };
}

/** Only a non-empty, `sha256:<hex>` content address is a registered artifact. */
function isContentAddress(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function availableEvidenceComplete(evidence: AvailableEvidenceInput | null): boolean {
  if (evidence === null || typeof evidence !== 'object') return false;
  return (
    evidence.data === true &&
    evidence.rights === true &&
    evidence.capability === true &&
    evidence.sourceCoverage === true &&
    evidence.poolAdapter === true &&
    evidence.cost === true &&
    evidence.capacity === true &&
    evidence.freshness === true
  );
}

/** The exact-scope registered statistical evidence, or a typed refusal. */
function selectStatisticalEvidence(
  registered: readonly RegisteredStatisticalEvidence[],
  scopeHash: string,
):
  | { readonly evidence: RegisteredStatisticalEvidence }
  | { readonly reason: ActivationGateRefusalReason } {
  const matching = registered.filter(
    (evidence) => typeof evidence.scopeHash === 'string' && evidence.scopeHash === scopeHash,
  );
  if (matching.length === 0) {
    return { reason: ActivationGateRefusalReason.STATISTICAL_EVIDENCE_MISSING };
  }
  if (matching.length > 1) {
    return { reason: ActivationGateRefusalReason.STATISTICAL_EVIDENCE_AMBIGUOUS };
  }
  const evidence = matching[0];
  if (evidence === undefined) {
    return { reason: ActivationGateRefusalReason.STATISTICAL_EVIDENCE_MISSING };
  }
  return { evidence };
}

const GATE_EVIDENCE_REFUSAL: Record<GateEvidenceFailureReason, ActivationGateRefusalReason> = {
  HASH_MISMATCH: ActivationGateRefusalReason.GATE_EVIDENCE_INVALID,
  SIGNATURE_INVALID: ActivationGateRefusalReason.GATE_EVIDENCE_INVALID,
  EVIDENCE_REVOKED: ActivationGateRefusalReason.GATE_EVIDENCE_INVALID,
  EVIDENCE_NOT_YET_VALID: ActivationGateRefusalReason.GATE_EVIDENCE_INVALID,
  EVIDENCE_EXPIRED: ActivationGateRefusalReason.GATE_EVIDENCE_INVALID,
  SCOPE_MISMATCH: ActivationGateRefusalReason.STATISTICAL_EVIDENCE_SCOPE_MISMATCH,
  PAYLOAD_RECORD_MISMATCH: ActivationGateRefusalReason.GATE_EVIDENCE_INVALID,
};

function evaluateCondition(
  gate: ActivationGateKind,
  input: ActivationGateInput,
  scopeHash: string,
  nowMs: number,
): GateConditionEvaluation {
  switch (gate) {
    case ActivationGateKind.IMPLEMENTED_PRESENT: {
      if (input.implemented !== true) {
        return refuse(
          gate,
          ActivationGateRefusalReason.MODULE_NOT_IMPLEMENTED,
          'no governed IMPLEMENTED state exists for the exact scope',
        );
      }
      return pass(gate);
    }
    case ActivationGateKind.AVAILABLE_EVIDENCE: {
      if (input.available !== true) {
        return refuse(
          gate,
          ActivationGateRefusalReason.AVAILABLE_NOT_ESTABLISHED,
          'the exact scope never reached the governed AVAILABLE dimension',
        );
      }
      if (!availableEvidenceComplete(input.availableEvidence)) {
        return refuse(
          gate,
          ActivationGateRefusalReason.AVAILABLE_EVIDENCE_MISSING,
          'data/rights/capability/source-coverage/pool-adapter/cost/capacity/freshness evidence is incomplete',
        );
      }
      return pass(gate);
    }
    case ActivationGateKind.PROVEN_PRESENT: {
      const scope = parseModuleStateScope(input.scope);
      if (!scope.requires_proven) return pass(gate);
      if (input.proven !== true) {
        return refuse(
          gate,
          ActivationGateRefusalReason.PROVEN_REQUIRED,
          'the exact scope requires PROVEN but no governed PROVEN dimension exists',
        );
      }
      return pass(gate);
    }
    case ActivationGateKind.STATISTICAL_EVIDENCE_SCOPE: {
      const selected = selectStatisticalEvidence(input.registeredStatisticalEvidence, scopeHash);
      if ('reason' in selected)
        return refuse(gate, selected.reason, 'no exact-scope registered statistical evidence');
      const expiresAt = Date.parse(selected.evidence.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
        return refuse(
          gate,
          ActivationGateRefusalReason.STATISTICAL_EVIDENCE_STALE,
          'the registered statistical evidence is expired for the evaluation instant',
        );
      }
      return pass(gate);
    }
    case ActivationGateKind.NEGATIVE_CONTROLS: {
      const selected = selectStatisticalEvidence(input.registeredStatisticalEvidence, scopeHash);
      if ('reason' in selected) {
        return refuse(
          gate,
          ActivationGateRefusalReason.NEGATIVE_CONTROL_MISSING,
          'negative controls cannot be read without exact-scope statistical evidence',
        );
      }
      const byControl = new Map(selected.evidence.negativeControls.map((c) => [c.control, c]));
      for (const control of ALL_NEGATIVE_CONTROL_KINDS) {
        const record = byControl.get(control);
        if (record === undefined) {
          return refuse(
            gate,
            ActivationGateRefusalReason.NEGATIVE_CONTROL_MISSING,
            `negative control ${control} is not registered`,
          );
        }
        if (record.passed !== true || record.unexplainedMaterialLift === true) {
          return refuse(
            gate,
            ActivationGateRefusalReason.NEGATIVE_CONTROL_FAILED,
            `negative control ${control} shows unexplained material lift`,
          );
        }
      }
      return pass(gate);
    }
    case ActivationGateKind.CLUSTERED_INTERVALS: {
      const selected = selectStatisticalEvidence(input.registeredStatisticalEvidence, scopeHash);
      if ('reason' in selected) {
        return refuse(
          gate,
          ActivationGateRefusalReason.CLUSTERED_INTERVALS_REQUIRED,
          'clustered intervals cannot be read without exact-scope statistical evidence',
        );
      }
      const method = selected.evidence.intervalMethod;
      if (!(CLUSTERED_INTERVAL_METHODS as readonly string[]).includes(method)) {
        return refuse(
          gate,
          ActivationGateRefusalReason.CLUSTERED_INTERVALS_REQUIRED,
          `registered interval method ${JSON.stringify(method)} is not a clustered/block method`,
        );
      }
      if (selected.evidence.clusterDefinition.length === 0) {
        return refuse(
          gate,
          ActivationGateRefusalReason.CLUSTERED_INTERVALS_REQUIRED,
          'a clustered interval must declare its cluster definition',
        );
      }
      if (selected.evidence.clusteredDiffersFromNaive !== true) {
        return refuse(
          gate,
          ActivationGateRefusalReason.CLUSTERED_INTERVALS_NOT_COMPARED,
          'the clustered interval was not shown to differ from the naive independent-token interval',
        );
      }
      return pass(gate);
    }
    case ActivationGateKind.CALIBRATION_MATURITY: {
      const selected = selectStatisticalEvidence(input.registeredStatisticalEvidence, scopeHash);
      if ('reason' in selected) {
        return refuse(
          gate,
          ActivationGateRefusalReason.CALIBRATION_IMMATURE,
          'calibration maturity cannot be read without exact-scope statistical evidence',
        );
      }
      const { calibration } = selected.evidence;
      if (calibration.expectedNetUtilityRankingEnabled && calibration.maturity !== 'MATURE') {
        return refuse(
          gate,
          ActivationGateRefusalReason.CALIBRATION_IMMATURE,
          `expected-net-utility ranking influence is enabled at ${calibration.maturity} calibration maturity`,
        );
      }
      if (calibration.expectedNetUtilityRankingEnabled && calibration.regimeDrift) {
        return refuse(
          gate,
          ActivationGateRefusalReason.CALIBRATION_IMMATURE,
          'ranking influence must degrade on regime drift rather than continue',
        );
      }
      return pass(gate);
    }
    case ActivationGateKind.VERIFIED_GATE_EVIDENCE: {
      const evidence = input.verifiedGateEvidence;
      if (evidence === null) {
        return refuse(
          gate,
          ActivationGateRefusalReason.GATE_EVIDENCE_MISSING,
          'no signed/hashed/expiring gate evidence was supplied',
        );
      }
      let verdict;
      try {
        verdict = evaluateGateEvidence({
          record: evidence.record,
          pepper: evidence.pepper,
          requiredScope: scopeHash,
          currentTime: input.now,
        });
      } catch {
        return refuse(
          gate,
          ActivationGateRefusalReason.GATE_EVIDENCE_INVALID,
          'gate evidence could not be evaluated (malformed record)',
        );
      }
      if (verdict.isValid !== true) {
        return refuse(
          gate,
          GATE_EVIDENCE_REFUSAL[verdict.reason],
          `verified gate evidence refused: ${verdict.reason}`,
        );
      }
      return pass(gate);
    }
    case ActivationGateKind.CAPACITY_CONTRACT: {
      const contract = input.capacityContract;
      if (contract === null) {
        return refuse(
          gate,
          ActivationGateRefusalReason.CAPACITY_CONTRACT_MISSING,
          'no sustainable-capacity contract was supplied',
        );
      }
      try {
        validateSustainableCapacityContract(contract);
      } catch {
        return refuse(
          gate,
          ActivationGateRefusalReason.CAPACITY_CONTRACT_INVALID,
          'the sustainable-capacity contract violates a capacity law',
        );
      }
      if (!isContractActivatable(contract)) {
        return refuse(
          gate,
          ActivationGateRefusalReason.CAPACITY_CONTRACT_NOT_PASS,
          `capacity contract ${contract.contractId} has result ${contract.result}`,
        );
      }
      if (Date.parse(contract.expiresAt) <= nowMs) {
        return refuse(
          gate,
          ActivationGateRefusalReason.CAPACITY_CONTRACT_EXPIRED,
          `capacity contract ${contract.contractId} expired at ${contract.expiresAt}`,
        );
      }
      return pass(gate);
    }
    case ActivationGateKind.DISTRIBUTION_EVIDENCE: {
      if (!isDistributionActivation(input.kind)) return pass(gate);
      const evidence = input.distributionEvidence;
      if (evidence === null) {
        return refuse(
          gate,
          ActivationGateRefusalReason.DISTRIBUTION_EVIDENCE_MISSING,
          'no workspace/public distribution evidence was supplied',
        );
      }
      const requiredReadiness =
        input.kind === ActivationKind.WORKSPACE
          ? DistributionReadiness.WORKSPACE_AUTHORIZED
          : DistributionReadiness.PUBLIC_AUTHORIZED;
      if (parseDistributionReadiness(evidence.distributionReadiness) !== requiredReadiness) {
        return refuse(
          gate,
          ActivationGateRefusalReason.DISTRIBUTION_NOT_AUTHORIZED,
          `distribution readiness ${evidence.distributionReadiness} is not ${requiredReadiness}`,
        );
      }
      if (evidence.rightsChangeBlockedPaths.length > 0) {
        return refuse(
          gate,
          ActivationGateRefusalReason.RIGHTS_CHANGE_OPEN,
          'a rights change still blocks newly prohibited cache/raw/export/redistribution/model-use paths (AC-273)',
        );
      }
      const checks: readonly (readonly [string, boolean])[] = [
        ['oauthTenantIsolation', evidence.oauthTenantIsolation],
        ['originClientCompatibility', evidence.originClientCompatibility],
        ['dataRightsRedistribution', evidence.dataRightsRedistribution],
        ['privacyRetentionDeletionExport', evidence.privacyRetentionDeletionExport],
        ['jurisdictionDisclosure', evidence.jurisdictionDisclosure],
        ['claimsReview', evidence.claimsReview],
        ['abuseRateLimitIncidentResponse', evidence.abuseRateLimitIncidentResponse],
        ['supportSecurityContact', evidence.supportSecurityContact],
        ['publicSafeRedaction', evidence.publicSafeRedaction],
        ['isolationFixtures', evidence.isolationFixtures],
      ];
      for (const [field, present] of checks) {
        if (present !== true) {
          return refuse(
            gate,
            ActivationGateRefusalReason.DISTRIBUTION_EVIDENCE_MISSING,
            `distribution evidence ${field} did not pass for the exact release`,
          );
        }
      }
      return pass(gate);
    }
    case ActivationGateKind.NO_OPEN_CONTAINMENT: {
      if (input.openContainment.length > 0) {
        return refuse(
          gate,
          ActivationGateRefusalReason.CONTAINMENT_OPEN,
          `open containment on the exact scope: ${input.openContainment.map((c) => c.action).join(', ')}`,
        );
      }
      return pass(gate);
    }
    default: {
      const exhaustive: never = gate;
      return refuse(
        ActivationGateKind.NO_OPEN_CONTAINMENT,
        ActivationGateRefusalReason.ACTIVATION_SCOPE_INVALID,
        `unknown gate ${String(exhaustive)}`,
      );
    }
  }
}

// --- the total gate ---------------------------------------------------------

/**
 * Evaluate the ordered gate set for one exact scope. Total and deterministic:
 * every gate in `ACTIVATION_GATE_ORDER` is evaluated in order and the FIRST
 * refusal (in canonical order, not in `requiredGates` order) is returned with
 * its gate name. Missing inputs fail closed.
 */
export function evaluateActivationGate(input: ActivationGateInput): ActivationGateResult {
  const scope = parseModuleStateScope(input.scope);
  const scopeHash = activationScopeHash(scope);
  const required = requiredGatesForActivation(input.kind, scope);
  const requiredSet = new Set<ActivationGateKind>(required);
  const nowMs = Date.parse(input.now);
  const evaluations: GateConditionEvaluation[] = [];
  for (const gate of ACTIVATION_GATE_ORDER) {
    if (!requiredSet.has(gate)) {
      evaluations.push(pass(gate));
      continue;
    }
    const evaluation = evaluateCondition(gate, input, scopeHash, nowMs);
    evaluations.push(evaluation);
    if (evaluation.verdict === ActivationGateVerdict.REFUSE) {
      const failingGate = evaluation.failingGate ?? gate;
      return {
        verdict: 'REFUSE',
        scopeHash,
        failingGate,
        reason: evaluation.reason ?? ActivationGateRefusalReason.ACTIVATION_SCOPE_INVALID,
        detail: evaluation.detail,
        evaluations,
      };
    }
  }
  const capacityContractRef = input.capacityContract?.contractId ?? '';
  return {
    verdict: 'PASS',
    scopeHash,
    evaluations,
    activationEventRef: input.activationEventRef,
    capacityContractRef,
    evaluatedAt: input.now,
    expiresAt: input.expiresAt,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
  };
}

/** Convenience predicate over the total gate. */
export function activationGatePassed(input: ActivationGateInput): boolean {
  return evaluateActivationGate(input).verdict === 'PASS';
}

// --- persistence ------------------------------------------------------------

/** One `prod.activation_gate_evaluations` write derived from a gate result. */
export interface ActivationGateEvaluationWrite {
  readonly scopeHash: string;
  readonly evaluations: readonly GateConditionEvaluation[];
  readonly capacityContractRef: string | null;
  readonly evaluatedAt: string;
  readonly expiresAt: string;
  readonly evidenceRefs: readonly string[];
  /** Deterministic id prefix; the gate kind is appended to keep rows unique. */
  readonly evaluationIdPrefix?: string;
}

/**
 * Persist one immutable `prod.activation_gate_evaluations` row per evaluated
 * gate. A re-evaluation is always a NEW row (the migration trigger refuses any
 * in-place edit); a passing row carries no failing gate.
 */
export async function recordActivationGateEvaluation(
  engine: DatabaseEngine,
  write: ActivationGateEvaluationWrite,
): Promise<readonly string[]> {
  if (!isContentAddress(write.scopeHash)) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'activation gate evaluation requires a sha256 scope hash',
      { scopeHash: write.scopeHash },
    );
  }
  if (write.evaluations.length === 0) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      'an activation gate evaluation must record at least one gate',
      {},
    );
  }
  const prefix = write.evaluationIdPrefix ?? 'gate-eval';
  return engine.transaction(async (tx) => {
    const ids: string[] = [];
    for (const evaluation of write.evaluations) {
      const gate = parseActivationGateKind(evaluation.gateKind);
      const verdict = parseActivationGateVerdict(evaluation.verdict);
      const failing =
        evaluation.failingGate === null ? null : parseActivationGateKind(evaluation.failingGate);
      const evaluationId = `${prefix}-${gate}-${sha256Text(
        canonicalJson({ scopeHash: write.scopeHash, gate, verdict, at: write.evaluatedAt }),
      ).slice(7, 23)}`;
      await tx.query(
        `INSERT INTO prod.activation_gate_evaluations
           (evaluation_id, scope_hash, gate_kind, verdict, failing_gate, evidence_refs,
            capacity_contract_ref, evaluated_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz, $9::timestamptz)`,
        [
          evaluationId,
          write.scopeHash,
          gate,
          verdict,
          failing,
          canonicalJson(write.evidenceRefs),
          write.capacityContractRef,
          write.evaluatedAt,
          write.expiresAt,
        ],
      );
      ids.push(evaluationId);
    }
    return ids;
  });
}

/** The latest persisted gate evaluations for an exact scope (append-only read). */
export async function activationGateEvaluationsFor(
  engine: DatabaseEngine,
  scopeHash: string,
): Promise<
  readonly {
    readonly evaluationId: string;
    readonly gateKind: ActivationGateKind;
    readonly verdict: ActivationGateVerdict;
    readonly failingGate: ActivationGateKind | null;
    readonly evaluatedAt: string;
    readonly expiresAt: string;
  }[]
> {
  const result = await engine.query<{
    evaluation_id: string;
    gate_kind: string;
    verdict: string;
    failing_gate: string | null;
    evaluated_at: unknown;
    expires_at: unknown;
  }>(
    `SELECT evaluation_id, gate_kind, verdict, failing_gate, evaluated_at, expires_at
       FROM prod.activation_gate_evaluations
      WHERE scope_hash = $1
      ORDER BY evaluated_at ASC, evaluation_id ASC`,
    [scopeHash],
  );
  return result.rows.map((row) => ({
    evaluationId: row.evaluation_id,
    gateKind: row.gate_kind as ActivationGateKind,
    verdict: row.verdict as ActivationGateVerdict,
    failingGate: row.failing_gate as ActivationGateKind | null,
    evaluatedAt:
      row.evaluated_at instanceof Date ? row.evaluated_at.toISOString() : String(row.evaluated_at),
    expiresAt:
      row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
  }));
}
