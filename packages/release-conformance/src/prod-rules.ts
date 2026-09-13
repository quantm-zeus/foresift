/**
 * PROD-facing release-conformance rules (T027, FR-PROD-001…006, AC-144/152/
 * 272/273/275/276/277/278/279; PRD §32/§33.7/§40/§69.2–§69.12; plan D8).
 *
 * These five rules LAYER over the four existing trace rules in
 * `conformance.ts` (`NORMATIVE_MAPPING_COMPLETE`,
 * `ACTIVE_IMPLEMENTATION_PATH_EXISTS`, `DEPENDENCY_GATE_NOT_OPEN`,
 * `GENERATED_DOCUMENT_DRIFT`, retained unchanged). They do NOT rewrite the
 * rule engine: every checker consumes already-resolved declarative inputs and
 * returns the existing `ConformanceFinding` shape, and every policy law is the
 * authoritative, total pure law from `@foresift/domain` — this module never
 * restates a vocabulary or recomputes a statistic, gate, capacity, or rights
 * result.
 *
 * A finding is a refusal, never a warning: an ACTIVE module without a passing
 * total gate, a best-effort declaration that weakens a protected dimension, a
 * draft/untested/stale MCP compatibility default, an unbounded or
 * boundary-crossing live path, or workspace/public authorization without the
 * full exact-release evidence set each fail the report closed.
 *
 * Strictly read-only: these rules decide whether read-only intelligence may be
 * released; nothing here can trade, hold custody, sign, handle private keys, or
 * submit a transaction.
 */
import {
  ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS,
  ALL_DEPLOYMENT_RELAXABLE_DIMENSIONS,
  ALL_PROTECTED_DIMENSIONS,
  MCP_LIVE_TEST_MAX_AGE_SECONDS,
  artifactBoundaryHolds,
  bestEffortWeakensOnlyAllowedDimensions,
  mcpCompatibilityCellUsable,
  mcpRevisionMayBeDefault,
  precomputedAlphaBoundRespected,
  type ArtifactBoundaryAssertion,
  type PrecomputedAlphaRequest,
} from '@foresift/domain';
import { CONFORMANCE_RULES, type ConformanceFinding } from './conformance.ts';

// --- rule vocabulary --------------------------------------------------------

/**
 * The five PROD rules. Keys mirror the existing camelCase naming; values are the
 * stable rule identifiers emitted on every finding.
 */
export const PROD_RULES = {
  activationWithoutEvidence: 'ACTIVATION_WITHOUT_EVIDENCE',
  postureWeakening: 'POSTURE_WEAKENING',
  mcpCompatibilityDrift: 'MCP_COMPATIBILITY_DRIFT',
  livePathPrecomputationViolation: 'LIVE_PATH_PRECOMPUTATION_VIOLATION',
  publicAuthorizationWithoutGateEvidence: 'PUBLIC_AUTHORIZATION_WITHOUT_GATE_EVIDENCE',
} as const;

export type ProdRule = (typeof PROD_RULES)[keyof typeof PROD_RULES];

/**
 * The complete rule vocabulary: the four existing trace rules plus the five
 * PROD rules. The existing entries are spread verbatim so the two vocabularies
 * can never drift.
 */
export const PROD_CONFORMANCE_RULES = {
  ...CONFORMANCE_RULES,
  ...PROD_RULES,
} as const;

export type ExtendedConformanceRule =
  (typeof PROD_CONFORMANCE_RULES)[keyof typeof PROD_CONFORMANCE_RULES];

/** Same shape as `ConformanceFinding`, widened to the layered vocabulary. */
export interface ProdConformanceFinding extends Omit<ConformanceFinding, 'rule'> {
  readonly rule: ExtendedConformanceRule;
}

/** The verdict of a single PROD rule. */
export interface ProdRuleReport {
  readonly passed: boolean;
  readonly findings: readonly ProdConformanceFinding[];
}

/** The aggregated PROD conformance verdict (same shape as `ConformanceResult`). */
export interface ProdConformanceReport {
  readonly overall: 'PASSED' | 'FAILED';
  readonly findings: readonly ProdConformanceFinding[];
}

/** The FR-PROD requirements each PROD rule serves (traceability only). */
export const PROD_RULE_REQUIREMENT_REFS: Readonly<Record<ProdRule, readonly string[]>> = {
  [PROD_RULES.activationWithoutEvidence]: ['FR-PROD-001', 'FR-PROD-002'],
  [PROD_RULES.postureWeakening]: ['FR-PROD-004'],
  [PROD_RULES.mcpCompatibilityDrift]: ['FR-PROD-005'],
  [PROD_RULES.livePathPrecomputationViolation]: ['FR-PROD-006'],
  [PROD_RULES.publicAuthorizationWithoutGateEvidence]: ['FR-PROD-002', 'FR-PROD-004'],
};

// --- rule 1: activation without evidence ------------------------------------

/** One module's claimed activation position for an exact §69.5 scope. */
export interface ModuleActivationClaim {
  readonly moduleId: string;
  /** The governed lifecycle position the claim asserts. */
  readonly lifecycleState: string;
  /** The independent FR-PROD-001 dimensions for the exact scope. */
  readonly implemented: boolean;
  readonly available: boolean;
  readonly proven: boolean;
  /** Whether the exact scope additionally requires PROVEN before ACTIVE. */
  readonly requiresProven: boolean;
  /** The activation event created by the passing total gate, or null. */
  readonly activationEventRef: string | null;
  /** The total gate verdict (`PASS`/`REFUSE`), or null when never evaluated. */
  readonly gateVerdict: string | null;
  readonly requirementId?: string;
}

const DEFAULT_ACTIVATION_REQUIREMENT = 'FR-PROD-002';

/**
 * An ACTIVE claim is honest only when the exact scope was IMPLEMENTED, reached
 * AVAILABLE, reached PROVEN whenever the scope requires it, carries a `PASS`
 * total-gate verdict, and names the activation event that gate created.
 * Deployment alone can never support an ACTIVE claim (AC-152).
 */
export function checkActivationWithoutEvidence(
  claims: readonly ModuleActivationClaim[],
): ProdRuleReport {
  const findings: ProdConformanceFinding[] = [];
  for (const claim of claims) {
    if (claim.lifecycleState !== 'ACTIVE') continue;
    const requirementId = claim.requirementId ?? DEFAULT_ACTIVATION_REQUIREMENT;
    const failures: string[] = [];
    if (claim.implemented !== true) failures.push('no governed IMPLEMENTED state');
    if (claim.available !== true) failures.push('AVAILABLE was never established');
    if (claim.requiresProven && claim.proven !== true) {
      failures.push('PROVEN is required by the scope but was never established');
    }
    if (claim.gateVerdict !== 'PASS') failures.push('no PASS activation-gate evaluation');
    if (claim.activationEventRef === null) failures.push('no activation event reference');
    for (const failure of failures) {
      findings.push({
        requirementId,
        rule: PROD_RULES.activationWithoutEvidence,
        path: claim.moduleId,
        message: `ACTIVE module ${claim.moduleId} lacks a passing activation gate: ${failure}`,
      });
    }
  }
  return { passed: findings.length === 0, findings };
}

// --- rule 2: posture weakening ----------------------------------------------

/** One declared deployment posture with its weakened/protected dimensions. */
export interface PostureWeakeningDeclaration {
  readonly declarationId: string;
  readonly posture: string;
  readonly weakenedDimensions: readonly string[];
  readonly protectedDimensions: readonly string[];
  readonly requirementId?: string;
}

const DEFAULT_POSTURE_REQUIREMENT = 'FR-PROD-004';

/**
 * §69.6/AC-153 law. A declaration may relax ONLY freshness, breadth, depth, and
 * opportunity alert availability, and it must assert every protected dimension
 * explicitly (an omitted dimension is a weakening by omission). `SLA_BACKED`
 * declares no weakening at all.
 */
export function checkPostureWeakening(
  declarations: readonly PostureWeakeningDeclaration[],
): ProdRuleReport {
  const findings: ProdConformanceFinding[] = [];
  for (const declaration of declarations) {
    const requirementId = declaration.requirementId ?? DEFAULT_POSTURE_REQUIREMENT;
    const findingsFor = (detail: string): void => {
      findings.push({
        requirementId,
        rule: PROD_RULES.postureWeakening,
        path: declaration.declarationId,
        message: `posture declaration ${declaration.declarationId} weakens a protected guarantee: ${detail}`,
      });
    };
    let domainAllows = false;
    try {
      domainAllows = bestEffortWeakensOnlyAllowedDimensions({
        posture: declaration.posture,
        weakenedDimensions: declaration.weakenedDimensions,
        protectedDimensions: declaration.protectedDimensions,
      });
    } catch {
      domainAllows = false;
    }
    if (!domainAllows) {
      findingsFor('the declaration violates the §69.6 protected-dimension law');
    }
    for (const dimension of new Set(declaration.weakenedDimensions)) {
      if ((ALL_PROTECTED_DIMENSIONS as readonly string[]).includes(dimension)) {
        findingsFor(`protected dimension ${dimension} is weakened`);
      } else if (!(ALL_DEPLOYMENT_RELAXABLE_DIMENSIONS as readonly string[]).includes(dimension)) {
        findingsFor(`unknown relaxable dimension ${dimension}`);
      }
    }
    const declaredProtected = new Set(declaration.protectedDimensions);
    const missingProtected = ALL_PROTECTED_DIMENSIONS.filter(
      (dimension) => !declaredProtected.has(dimension),
    );
    if (missingProtected.length > 0) {
      findingsFor(`protected dimensions omitted: ${missingProtected.join(', ')}`);
    }
  }
  return { passed: findings.length === 0, findings };
}

// --- rule 3: MCP compatibility drift ----------------------------------------

export interface McpRevisionClaim {
  readonly revision: string;
  readonly channel: string;
  readonly isDefault: boolean;
  readonly supersededBy?: string | null;
}

export interface McpTargetClientClaim {
  readonly clientId: string;
}

export interface McpCompatibilityCellClaim {
  readonly revision: string;
  readonly clientId: string;
  readonly result: string;
  readonly liveTestDate: string;
}

/** A fully resolved MCP revision/client/cell matrix snapshot. */
export interface McpCompatibilityMatrixClaim {
  readonly revisions: readonly McpRevisionClaim[];
  readonly clients: readonly McpTargetClientClaim[];
  readonly cells: readonly McpCompatibilityCellClaim[];
  readonly now: string;
  readonly maxAgeSeconds?: number;
  readonly requirementId?: string;
}

const DEFAULT_MCP_REQUIREMENT = 'FR-PROD-005';

/**
 * §69.7/AC-144 law. The declared default must be a STABLE revision, and every
 * supported target client must carry a PASSING, non-stale conformance cell for
 * that exact default. A draft default, a missing default, an untested pair, a
 * failing result, or a stale live test each drift the release.
 */
export function checkMcpCompatibilityDrift(claim: McpCompatibilityMatrixClaim): ProdRuleReport {
  const requirementId = claim.requirementId ?? DEFAULT_MCP_REQUIREMENT;
  const findings: ProdConformanceFinding[] = [];
  const report = (path: string, detail: string): void => {
    findings.push({
      requirementId,
      rule: PROD_RULES.mcpCompatibilityDrift,
      path,
      message: `MCP compatibility drift: ${detail}`,
    });
  };

  for (const revision of claim.revisions) {
    if (revision.isDefault !== true) continue;
    let mayBeDefault = false;
    try {
      mayBeDefault = mcpRevisionMayBeDefault({
        revision: revision.revision,
        channel: revision.channel,
        isDefault: revision.isDefault,
      });
    } catch {
      mayBeDefault = false;
    }
    if (!mayBeDefault) {
      report(
        revision.revision,
        `default revision ${revision.revision} is channel ${revision.channel}; only STABLE may default (§69.7)`,
      );
    }
  }

  const defaults = claim.revisions.filter((revision) => revision.isDefault === true);
  if (defaults.length === 0) {
    report('(default-revision)', 'no MCP revision is declared as the compatibility default');
    return { passed: findings.length === 0, findings };
  }
  if (defaults.length > 1) {
    report(
      '(default-revision)',
      `multiple revisions claim the compatibility default: ${defaults
        .map((revision) => revision.revision)
        .join(', ')}`,
    );
  }

  const maxAgeSeconds = claim.maxAgeSeconds ?? MCP_LIVE_TEST_MAX_AGE_SECONDS;
  for (const defaultRevision of defaults) {
    for (const client of claim.clients) {
      const path = `${defaultRevision.revision}\u00d7${client.clientId}`;
      const cell = claim.cells.find(
        (candidate) =>
          candidate.revision === defaultRevision.revision && candidate.clientId === client.clientId,
      );
      if (cell === undefined) {
        report(path, `no conformance cell for the default revision and client`);
        continue;
      }
      if (cell.result !== 'PASS') {
        report(path, `conformance result is ${cell.result}, not PASS`);
        continue;
      }
      let usable = false;
      try {
        usable = mcpCompatibilityCellUsable(
          {
            revision: cell.revision,
            clientId: cell.clientId,
            result: cell.result,
            liveTestDate: cell.liveTestDate,
          },
          claim.now,
          maxAgeSeconds,
        );
      } catch {
        usable = false;
      }
      if (!usable) {
        report(path, `the live test at ${cell.liveTestDate} is stale or invalid`);
      }
    }
  }
  return { passed: findings.length === 0, findings };
}

// --- rule 4: live-path precomputation violation -----------------------------

export interface LivePathBoundClaim {
  readonly artifactSetHash: string;
  readonly maxCandidates: number;
  readonly maxRows: number;
  readonly maxEdges: number;
  readonly maxLatencyMs: number;
  readonly maxCostUsd: number;
  readonly expiresAt: string;
}

/** One live path with its declared bound, request, and boundary assertions. */
export interface LivePathPrecomputationClaim {
  readonly livePath: string;
  readonly bound: LivePathBoundClaim | null;
  readonly request: PrecomputedAlphaRequest;
  readonly now: string;
  readonly boundaryAssertions: readonly ArtifactBoundaryAssertion[];
  readonly artifactRef?: string;
  readonly requirementId?: string;
}

const DEFAULT_PRECOMPUTED_REQUIREMENT = 'FR-PROD-006';

/**
 * §33.7/§10.3/§35.14/AC-279 law. A live path must serve only a bounded,
 * unexpired precomputed lookup within every declared ceiling, and its exported
 * artifact-boundary assertion set must hold (no heavy Alpha Lab job, no
 * artifact import, no provider call on the live path). Missing ceilings,
 * exceeded ceilings, expiry, and any failing/missing assertion each refuse.
 */
export function checkLivePathPrecomputationViolation(
  claims: readonly LivePathPrecomputationClaim[],
): ProdRuleReport {
  const findings: ProdConformanceFinding[] = [];
  for (const claim of claims) {
    const requirementId = claim.requirementId ?? DEFAULT_PRECOMPUTED_REQUIREMENT;
    const report = (detail: string): void => {
      findings.push({
        requirementId,
        rule: PROD_RULES.livePathPrecomputationViolation,
        path: claim.livePath,
        message: `live path ${claim.livePath} violates its precomputation boundary: ${detail}`,
      });
    };
    if (claim.bound === null) {
      report('no bounded precomputed-alpha envelope is declared');
    } else {
      let respected = false;
      try {
        respected = precomputedAlphaBoundRespected(
          {
            artifactSetHash: claim.bound.artifactSetHash,
            maxCandidates: claim.bound.maxCandidates,
            maxRows: claim.bound.maxRows,
            maxEdges: claim.bound.maxEdges,
            maxLatencyMs: claim.bound.maxLatencyMs,
            maxCostUsd: claim.bound.maxCostUsd,
            expiresAt: claim.bound.expiresAt,
          },
          claim.request,
          claim.now,
        );
      } catch {
        respected = false;
      }
      if (!respected) {
        report('the lookup is unbounded, expired, or exceeds a declared ceiling');
      }
    }
    if (!artifactBoundaryHolds(claim.boundaryAssertions)) {
      const present = new Set(
        claim.boundaryAssertions.map((assertion) => String(assertion.assertionKind)),
      );
      const missing = ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS.filter((kind) => !present.has(kind));
      const failing = claim.boundaryAssertions.filter(
        (assertion) => assertion.verdict !== 'PASS',
      ).length;
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`missing assertions ${missing.join(', ')}`);
      if (failing > 0) parts.push(`${failing} failing assertion(s)`);
      report(
        parts.length > 0
          ? parts.join('; ')
          : 'the live path reaches a heavy job, artifact import, or provider call',
      );
    }
  }
  return { passed: findings.length === 0, findings };
}

// --- rule 5: public authorization without gate evidence ---------------------

/** One gate-evidence record scoped to an exact release. */
export interface DistributionGateEvidenceClaim {
  readonly evidenceId: string;
  readonly gateKind: string;
  readonly scopeRefs: readonly string[];
  readonly revokedAt?: string | null;
  /** The result of the authoritative `evaluateGateEvidence` check. */
  readonly valid: boolean;
}

/** One distribution-readiness claim for an exact release. */
export interface DistributionAuthorizationClaim {
  readonly releaseRef: string;
  readonly distributionReadiness: string;
  /** The gate kinds the release's distribution activation requires. */
  readonly requiredGateKinds: readonly string[];
  readonly gateEvidence: readonly DistributionGateEvidenceClaim[];
  readonly requirementId?: string;
}

export interface DistributionAuthorizationEvaluation {
  readonly authorized: boolean;
  readonly readinessAuthorized: boolean;
  readonly missingGateKinds: readonly string[];
  readonly mismatchedGateKinds: readonly string[];
  readonly revokedOrInvalidGateKinds: readonly string[];
}

const AUTHORIZED_DISTRIBUTION_READINESS: readonly string[] = [
  'WORKSPACE_AUTHORIZED',
  'PUBLIC_AUTHORIZED',
];
const DEFAULT_PUBLIC_AUTHORIZATION_REQUIREMENT = 'FR-PROD-002';

/**
 * §69.9 law. `WORKSPACE_TECHNICALLY_READY`/`PUBLIC_TECHNICALLY_READY` are
 * honest not-yet-authorized positions; only `*_AUTHORIZED` claims authorization,
 * and only when every required gate kind has a valid, unrevoked, exact-release
 * scoped evidence record. Technically-ready-without-evidence therefore stays
 * unauthorized (AC-272/273/275/276/277).
 */
export function evaluateDistributionAuthorization(
  claim: DistributionAuthorizationClaim,
): DistributionAuthorizationEvaluation {
  const readinessAuthorized = AUTHORIZED_DISTRIBUTION_READINESS.includes(
    claim.distributionReadiness,
  );
  const missingGateKinds: string[] = [];
  const mismatchedGateKinds: string[] = [];
  const revokedOrInvalidGateKinds: string[] = [];
  for (const gateKind of claim.requiredGateKinds) {
    const matching = claim.gateEvidence.filter((evidence) => evidence.gateKind === gateKind);
    if (matching.length === 0) {
      missingGateKinds.push(gateKind);
      continue;
    }
    const inScope = matching.filter((evidence) => evidence.scopeRefs.includes(claim.releaseRef));
    if (inScope.length === 0) {
      mismatchedGateKinds.push(gateKind);
      continue;
    }
    const usable = inScope.some(
      (evidence) =>
        evidence.valid === true &&
        (evidence.revokedAt === undefined || evidence.revokedAt === null),
    );
    if (!usable) revokedOrInvalidGateKinds.push(gateKind);
  }
  return {
    authorized:
      readinessAuthorized &&
      missingGateKinds.length === 0 &&
      mismatchedGateKinds.length === 0 &&
      revokedOrInvalidGateKinds.length === 0,
    readinessAuthorized,
    missingGateKinds,
    mismatchedGateKinds,
    revokedOrInvalidGateKinds,
  };
}

/** Flag every `*_AUTHORIZED` claim whose exact-release evidence set is incomplete. */
export function checkPublicAuthorizationWithoutGateEvidence(
  claims: readonly DistributionAuthorizationClaim[],
): ProdRuleReport {
  const findings: ProdConformanceFinding[] = [];
  for (const claim of claims) {
    const evaluation = evaluateDistributionAuthorization(claim);
    if (!evaluation.readinessAuthorized || evaluation.authorized) continue;
    const requirementId = claim.requirementId ?? DEFAULT_PUBLIC_AUTHORIZATION_REQUIREMENT;
    const details: string[] = [];
    if (evaluation.missingGateKinds.length > 0) {
      details.push(`missing gate evidence: ${evaluation.missingGateKinds.join(', ')}`);
    }
    if (evaluation.mismatchedGateKinds.length > 0) {
      details.push(
        `evidence not scoped to release ${claim.releaseRef}: ${evaluation.mismatchedGateKinds.join(', ')}`,
      );
    }
    if (evaluation.revokedOrInvalidGateKinds.length > 0) {
      details.push(
        `revoked or invalid gate evidence: ${evaluation.revokedOrInvalidGateKinds.join(', ')}`,
      );
    }
    findings.push({
      requirementId,
      rule: PROD_RULES.publicAuthorizationWithoutGateEvidence,
      path: claim.releaseRef,
      message: `${claim.distributionReadiness} authorization lacks the full evidence set: ${details.join('; ')}`,
    });
  }
  return { passed: findings.length === 0, findings };
}

// --- aggregation ------------------------------------------------------------

export interface ProdConformanceInput {
  readonly activationClaims?: readonly ModuleActivationClaim[];
  readonly postureDeclarations?: readonly PostureWeakeningDeclaration[];
  readonly mcpCompatibility?: McpCompatibilityMatrixClaim;
  readonly livePaths?: readonly LivePathPrecomputationClaim[];
  readonly distributionAuthorizations?: readonly DistributionAuthorizationClaim[];
}

/**
 * Evaluate every PROD rule and aggregate the findings into one report whose
 * shape matches `ConformanceResult`. `overall` is `FAILED` when any finding was
 * produced.
 */
export function evaluateProdConformance(input: ProdConformanceInput): ProdConformanceReport {
  const findings: ProdConformanceFinding[] = [
    ...checkActivationWithoutEvidence(input.activationClaims ?? []).findings,
    ...checkPostureWeakening(input.postureDeclarations ?? []).findings,
    ...(input.mcpCompatibility === undefined
      ? []
      : checkMcpCompatibilityDrift(input.mcpCompatibility).findings),
    ...checkLivePathPrecomputationViolation(input.livePaths ?? []).findings,
    ...checkPublicAuthorizationWithoutGateEvidence(input.distributionAuthorizations ?? []).findings,
  ];
  return { overall: findings.length === 0 ? 'PASSED' : 'FAILED', findings };
}
