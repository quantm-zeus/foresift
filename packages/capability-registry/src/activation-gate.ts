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
  activationGateRefusal,
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

// --- provenance brand -------------------------------------------------------

/**
 * Module-private provenance brand for an `ActivationGatePass`. It is NOT
 * exported, so no caller can mint the symbol: `evaluateActivationGate` is the
 * ONLY writer. A hand-built PASS object therefore fails the branded recorder
 * signatures at compile time, and the runtime brand check refuses a cast object
 * too, so a fabricated all-PASS evaluation set can never be persisted as
 * "evidence".
 *
 * TRUST BOUNDARY (precise): the brand attests that the RESULT SHAPE was produced
 * by the authoritative evaluator — it proves the object is a gate result, not a
 * caller's invention. It does NOT attest the INPUTS: the caller is trusted
 * product code and supplies the evidence (registered statistics, signed gate
 * evidence, capacity contract) that the evaluator consumes. What makes the
 * persisted evidence authoritative for ACTIVE is that `advanceState` re-derives
 * the evidence reference from rows actually written to
 * `prod.activation_gate_evaluations`, not from this object.
 */
const ACTIVATION_PASS_BRAND: unique symbol = Symbol('foresift.prod.activation-pass');

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
  /** The kind this pass was evaluated for; the legal required-gate superset. */
  readonly activationKind: ActivationKind;
  /**
   * Module-private provenance brand. `evaluateActivationGate` is the only
   * writer; see `ACTIVATION_PASS_BRAND`. The property is required, so a
   * hand-built object literal can never satisfy `ActivationGatePass`.
   */
  readonly [ACTIVATION_PASS_BRAND]: true;
  /**
   * Persisted-evidence reference. The pure evaluator always leaves this `null`;
   * only the branded recorders (`recordActivationGateResult` /
   * `recordActivationGateEvaluation`) mint the deterministic hash over the rows
   * they persisted, and `advanceState` re-derives it from the database before it
   * will cross into ACTIVE.
   */
  readonly evaluationSetRef: string | null;
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

/**
 * Fail-closed provenance check for every writer of
 * `prod.activation_gate_evaluations`. A caller cannot obtain the module-private
 * `ACTIVATION_PASS_BRAND` symbol, so only an object returned by
 * `evaluateActivationGate` (or a spread-derived copy of one) passes; a cast or
 * hand-built PASS is refused with `PROD_ACTIVATION_GATE_REFUSED`.
 */
function requireActivationPassBrand(value: unknown): asserts value is ActivationGatePass {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as { readonly [ACTIVATION_PASS_BRAND]?: unknown })[ACTIVATION_PASS_BRAND] !== true
  ) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      'activation-gate evidence must be an ActivationGatePass returned by evaluateActivationGate; the supplied object carries no evaluator provenance brand',
      { reason: 'ACTIVATION_PASS_UNBRANDED' },
    );
  }
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
    activationKind: input.kind,
    evaluationSetRef: null,
    [ACTIVATION_PASS_BRAND]: true,
  };
}

/** Convenience predicate over the total gate. */
export function activationGatePassed(input: ActivationGateInput): boolean {
  return evaluateActivationGate(input).verdict === 'PASS';
}

// --- persistence ------------------------------------------------------------

/** One persisted `prod.activation_gate_evaluations` row, decoded. */
export interface PersistedActivationGateEvaluation {
  readonly evaluationId: string;
  readonly scopeHash: string;
  readonly gateKind: ActivationGateKind;
  readonly verdict: ActivationGateVerdict;
  readonly failingGate: ActivationGateKind | null;
  readonly activationEventRef: string | null;
  readonly capacityContractRef: string | null;
  readonly evidenceRefs: readonly string[];
  readonly evaluatedAt: string;
  readonly expiresAt: string;
}

/** The recorder's receipt: the persisted ids plus the persisted-evidence set reference. */
export interface RecordedActivationGateEvaluation {
  readonly evaluationIds: readonly string[];
  readonly evaluationSetRef: string;
}

interface RawGateEvaluationRow {
  evaluation_id: string;
  scope_hash: string;
  gate_kind: string;
  verdict: string;
  failing_gate: string | null;
  activation_event_ref: string | null;
  capacity_contract_ref: string | null;
  evidence_refs: unknown;
  evaluated_at: unknown;
  expires_at: unknown;
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function decodeEvidenceRefs(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function decodeGateEvaluationRow(row: RawGateEvaluationRow): PersistedActivationGateEvaluation {
  return {
    evaluationId: row.evaluation_id,
    scopeHash: row.scope_hash,
    gateKind: row.gate_kind as ActivationGateKind,
    verdict: row.verdict as ActivationGateVerdict,
    failingGate: row.failing_gate as ActivationGateKind | null,
    activationEventRef: row.activation_event_ref,
    capacityContractRef: row.capacity_contract_ref,
    evidenceRefs: decodeEvidenceRefs(row.evidence_refs),
    evaluatedAt: toIsoTimestamp(row.evaluated_at),
    expiresAt: toIsoTimestamp(row.expires_at),
  };
}

const GATE_EVALUATION_COLUMNS = `evaluation_id, scope_hash, gate_kind, verdict, failing_gate,
        activation_event_ref, capacity_contract_ref, evidence_refs, evaluated_at, expires_at`;

/**
 * The persisted-evidence reference for one evaluation set: a deterministic
 * `sha256:<hex>` content address over the exact rows, in canonical gate order.
 * The recorder mints it from the rows it committed; `advanceState` re-derives it
 * from the database, so a caller-constructed object cannot name evidence that
 * was never persisted.
 */
export function activationEvidenceSetRef(
  rows: readonly PersistedActivationGateEvaluation[],
): string {
  const ordered = [...rows].sort(
    (left, right) =>
      ACTIVATION_GATE_ORDER.indexOf(left.gateKind) - ACTIVATION_GATE_ORDER.indexOf(right.gateKind),
  );
  return sha256Text(
    canonicalJson(
      ordered.map((row) => ({
        evaluationId: row.evaluationId,
        scopeHash: row.scopeHash,
        gateKind: row.gateKind,
        verdict: row.verdict,
        failingGate: row.failingGate,
        activationEventRef: row.activationEventRef,
        capacityContractRef: row.capacityContractRef,
        evidenceRefs: row.evidenceRefs,
        evaluatedAt: row.evaluatedAt,
        expiresAt: row.expiresAt,
      })),
    ),
  );
}

/**
 * Persist one immutable `prod.activation_gate_evaluations` row per evaluated
 * gate. A re-evaluation is always a NEW row (the migration trigger refuses any
 * in-place edit); a passing row carries no failing gate. The returned
 * `evaluationSetRef` is the only reference `advanceState` will accept when
 * crossing into ACTIVE: it is derived from the rows actually committed here.
 *
 * The writer is BRANDED: it accepts only an `ActivationGatePass` produced by
 * `evaluateActivationGate`, so a caller cannot persist a hand-built all-PASS
 * evaluation set and then claim it as evidence. (The brand attests result
 * provenance only; see `ACTIVATION_PASS_BRAND` for the input trust boundary.)
 */
export async function recordActivationGateEvaluation(
  engine: DatabaseEngine,
  pass: ActivationGatePass,
): Promise<RecordedActivationGateEvaluation> {
  requireActivationPassBrand(pass);
  if (!isContentAddress(pass.scopeHash)) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'activation gate evaluation requires a sha256 scope hash',
      { scopeHash: pass.scopeHash },
    );
  }
  if (pass.evaluations.length === 0) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      'an activation gate evaluation must record at least one gate',
      { reason: 'ACTIVATION_PASS_EVALUATIONS_EMPTY' },
    );
  }
  return engine.transaction(async (tx) => {
    const ids: string[] = [];
    for (const evaluation of pass.evaluations) {
      const gate = parseActivationGateKind(evaluation.gateKind);
      const verdict = parseActivationGateVerdict(evaluation.verdict);
      const failing =
        evaluation.failingGate === null ? null : parseActivationGateKind(evaluation.failingGate);
      const evaluationId = `gate-eval-${gate}-${sha256Text(
        canonicalJson({ scopeHash: pass.scopeHash, gate, verdict, at: pass.evaluatedAt }),
      ).slice(7, 23)}`;
      await tx.query(
        `INSERT INTO prod.activation_gate_evaluations
           (evaluation_id, scope_hash, gate_kind, verdict, failing_gate, evidence_refs,
            capacity_contract_ref, activation_event_ref, evaluated_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::timestamptz, $10::timestamptz)`,
        [
          evaluationId,
          pass.scopeHash,
          gate,
          verdict,
          failing,
          canonicalJson(pass.evidenceRefs),
          pass.capacityContractRef,
          pass.activationEventRef,
          pass.evaluatedAt,
          pass.expiresAt,
        ],
      );
      ids.push(evaluationId);
    }
    // Re-read the rows just committed so the minted reference is derived from
    // database truth (exact timestamps and ids), never from the caller's object.
    const persisted = await tx.query<RawGateEvaluationRow>(
      `SELECT ${GATE_EVALUATION_COLUMNS}
         FROM prod.activation_gate_evaluations
        WHERE scope_hash = $1 AND evaluated_at = $2::timestamptz
        ORDER BY evaluation_id ASC`,
      [pass.scopeHash, pass.evaluatedAt],
    );
    const rows = persisted.rows.map(decodeGateEvaluationRow);
    return { evaluationIds: ids, evaluationSetRef: activationEvidenceSetRef(rows) };
  });
}

/**
 * Record a pure gate result as its persisted evidence and return the SAME result
 * bound to the persisted `evaluationSetRef`. A REFUSE is never evidence for an
 * activation, so it is returned unrecorded and unbound.
 *
 * Only a branded `ActivationGatePass` — an object produced by
 * `evaluateActivationGate` — can reach the writer; a hand-built PASS is refused
 * with `PROD_ACTIVATION_GATE_REFUSED` and persists ZERO rows.
 */
export async function recordActivationGateResult(
  engine: DatabaseEngine,
  result: ActivationGateResult,
): Promise<ActivationGateResult> {
  if (result.verdict !== 'PASS') return result;
  requireActivationPassBrand(result);
  const recorded = await recordActivationGateEvaluation(engine, result);
  return { ...result, evaluationSetRef: recorded.evaluationSetRef };
}

/** Every persisted gate evaluation for an exact scope (append-only read). */
export async function activationGateEvaluationsFor(
  engine: DatabaseEngine,
  scopeHash: string,
): Promise<readonly PersistedActivationGateEvaluation[]> {
  const result = await engine.query<RawGateEvaluationRow>(
    `SELECT ${GATE_EVALUATION_COLUMNS}
       FROM prod.activation_gate_evaluations
      WHERE scope_hash = $1
      ORDER BY evaluated_at ASC, evaluation_id ASC`,
    [scopeHash],
  );
  return result.rows.map(decodeGateEvaluationRow);
}

// --- persisted-evidence activation guard ------------------------------------

/** Closed typed refusal reasons for a claimed-but-unpersisted gate pass. */
export const ActivationEvidenceRefusalReason = {
  EVIDENCE_SET_REF_MISSING: 'EVIDENCE_SET_REF_MISSING',
  EVIDENCE_SET_EMPTY: 'EVIDENCE_SET_EMPTY',
  EVIDENCE_SET_INCOMPLETE: 'EVIDENCE_SET_INCOMPLETE',
  EVIDENCE_SET_NOT_PASS: 'EVIDENCE_SET_NOT_PASS',
  EVIDENCE_SET_STALE: 'EVIDENCE_SET_STALE',
  EVIDENCE_EVENT_REF_UNPERSISTED: 'EVIDENCE_EVENT_REF_UNPERSISTED',
  EVIDENCE_SET_REF_MISMATCH: 'EVIDENCE_SET_REF_MISMATCH',
} as const;
export type ActivationEvidenceRefusalReason =
  (typeof ActivationEvidenceRefusalReason)[keyof typeof ActivationEvidenceRefusalReason];

/** Input for the persisted-evidence activation guard. */
export interface PersistedActivationEvidenceInput {
  readonly scope: ModuleStateScope;
  readonly scopeHash: string;
  readonly activationKind: ActivationKind;
  readonly activationEventRef: string;
  readonly evaluationSetRef: string | null | undefined;
  /** The logical transition instant; a set expiring at or before it is stale. */
  readonly at: string;
}

/**
 * Fail-closed guard: require a COMPLETE, in-order, unexpired, all-PASS set of
 * persisted `prod.activation_gate_evaluations` rows for the exact scope and the
 * exact activation event, and require the caller's `evaluationSetRef` to equal
 * the reference re-derived from those rows.
 *
 * A caller-supplied `ActivationGateResult` object is never sufficient: the rows
 * must exist, must cover every gate required for the activation kind, must carry
 * the same activation event, and must not have expired. Any missing, failing,
 * stale, scope-mismatched, or unpersisted evidence refuses with
 * `PROD_ACTIVATION_GATE_REFUSED` and a typed `ActivationEvidenceRefusalReason`.
 */
export async function requirePersistedActivationEvidence(
  engine: DatabaseEngine,
  input: PersistedActivationEvidenceInput,
): Promise<RecordedActivationGateEvaluation> {
  const refuse = (reason: ActivationEvidenceRefusalReason, detail: string): never => {
    throw new ForesiftError(ErrorCode.PROD_ACTIVATION_GATE_REFUSED, detail, {
      reason,
      scopeHash: input.scopeHash,
      activationEventRef: input.activationEventRef,
    });
  };
  if (typeof input.evaluationSetRef !== 'string' || input.evaluationSetRef.length === 0) {
    refuse(
      ActivationEvidenceRefusalReason.EVIDENCE_SET_REF_MISSING,
      'entering ACTIVE requires a gate result bound to persisted evidence; no evaluationSetRef was supplied',
    );
  }
  const rows = await activationGateEvaluationsFor(engine, input.scopeHash);
  if (rows.length === 0) {
    refuse(
      ActivationEvidenceRefusalReason.EVIDENCE_SET_EMPTY,
      'no persisted activation-gate evaluations exist for the exact scope; a hand-built PASS object is not evidence',
    );
  }
  // The latest evaluation batch is the only admissible evidence; an older PASS
  // never survives a later re-evaluation.
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const at = Date.parse(row.evaluatedAt);
    if (Number.isFinite(at) && at > latestAt) latestAt = at;
  }
  const batch = rows.filter((row) => Date.parse(row.evaluatedAt) === latestAt);
  if (batch.length === 0) {
    refuse(
      ActivationEvidenceRefusalReason.EVIDENCE_SET_EMPTY,
      'the persisted activation-gate evaluations carry no resolvable evaluation instant',
    );
  }
  const atMs = Date.parse(input.at);
  for (const row of batch) {
    if (row.activationEventRef !== input.activationEventRef) {
      refuse(
        ActivationEvidenceRefusalReason.EVIDENCE_EVENT_REF_UNPERSISTED,
        `the persisted evidence was recorded for activation event ${JSON.stringify(
          row.activationEventRef,
        )}, not ${JSON.stringify(input.activationEventRef)}`,
      );
    }
    if (row.verdict !== 'PASS' || row.failingGate !== null) {
      refuse(
        ActivationEvidenceRefusalReason.EVIDENCE_SET_NOT_PASS,
        `the latest persisted gate ${row.gateKind} verdict is ${row.verdict}`,
      );
    }
    if (Date.parse(row.expiresAt) <= atMs) {
      refuse(
        ActivationEvidenceRefusalReason.EVIDENCE_SET_STALE,
        `the persisted gate ${row.gateKind} evidence expired at ${row.expiresAt}`,
      );
    }
  }
  const evaluations = batch.map((row) => ({
    gateKind: row.gateKind,
    verdict: row.verdict,
    failingGate: row.failingGate,
  }));
  // Cover every gate required for the activation kind AND the full canonical
  // order, so a partial evaluation can never stand in for a total one.
  const requiredFailing = activationGateRefusal(
    evaluations,
    requiredGatesForActivation(input.activationKind, input.scope),
  );
  if (requiredFailing !== null) {
    refuse(
      ActivationEvidenceRefusalReason.EVIDENCE_SET_INCOMPLETE,
      `the persisted evidence is missing a passing evaluation for ${requiredFailing}`,
    );
  }
  const totalFailing = activationGateRefusal(evaluations, ACTIVATION_GATE_ORDER);
  if (totalFailing !== null) {
    refuse(
      ActivationEvidenceRefusalReason.EVIDENCE_SET_INCOMPLETE,
      `the persisted evidence does not cover the complete ordered gate set: ${totalFailing}`,
    );
  }
  const derived = activationEvidenceSetRef(batch);
  if (derived !== input.evaluationSetRef) {
    refuse(
      ActivationEvidenceRefusalReason.EVIDENCE_SET_REF_MISMATCH,
      'the supplied evaluationSetRef does not match the reference re-derived from the persisted rows',
    );
  }
  return { evaluationIds: batch.map((row) => row.evaluationId), evaluationSetRef: derived };
}
