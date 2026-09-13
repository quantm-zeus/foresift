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
  parseDistributionReadiness,
  parseModuleLifecyclePosition,
  precomputedAlphaBoundRespected,
  type ArtifactBoundaryAssertion,
  type PrecomputedAlphaRequest,
} from '@foresift/domain';
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { resolveMappings } from '@foresift/requirement-manifest';
import { ImportQuarantineStateSchema } from '@foresift/shared-schemas';
import { CONFORMANCE_RULES, implementationPath, type ConformanceFinding } from './conformance.ts';
import { GATE_KINDS } from './gate-evidence.ts';

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
  /** A mandatory release-gate input was omitted instead of declared (audit H2). */
  prodConformanceInputMissing: 'PROD_CONFORMANCE_INPUT_MISSING',
  /** A declared PROD surface ref does not resolve in the live repository (H1). */
  prodSurfaceMissing: 'PROD_SURFACE_MISSING',
} as const;

/** The five claim-shaped PROD rules (the repo-backed surface rule is separate). */
export const CLAIM_PROD_RULES = [
  'activationWithoutEvidence',
  'postureWeakening',
  'mcpCompatibilityDrift',
  'livePathPrecomputationViolation',
  'publicAuthorizationWithoutGateEvidence',
] as const satisfies readonly (keyof typeof PROD_RULES)[];

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
  [PROD_RULES.prodConformanceInputMissing]: ['FR-PROD-001', 'FR-PROD-002', 'FR-PROD-006'],
  [PROD_RULES.prodSurfaceMissing]: ['FR-PROD-001', 'FR-PROD-002', 'FR-PROD-003'],
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
  // Numeric-index iteration (never `for…of`) so an in-process caller cannot
  // shadow `Symbol.iterator` on its own array and hide malformed claims; the
  // JSON release gate is unaffected either way.
  for (let claimIndex = 0; claimIndex < claims.length; claimIndex += 1) {
    const claim = claims[claimIndex];
    if (claim === undefined || claim === null) {
      findings.push({
        requirementId: DEFAULT_ACTIVATION_REQUIREMENT,
        rule: PROD_RULES.activationWithoutEvidence,
        path: `activationClaims[${claimIndex}]`,
        message: `activationClaims[${claimIndex}] is not a claim object; a malformed claim fails closed`,
      });
      continue;
    }
    const requirementId = claim.requirementId ?? DEFAULT_ACTIVATION_REQUIREMENT;
    // An unparseable governed position is not a non-ACTIVE position: it fails
    // closed instead of being silently skipped (audit R2 residual).
    let lifecycleKnown = true;
    try {
      parseModuleLifecyclePosition(claim.lifecycleState);
    } catch {
      lifecycleKnown = false;
    }
    if (!lifecycleKnown) {
      findings.push({
        requirementId,
        rule: PROD_RULES.activationWithoutEvidence,
        path: claim.moduleId,
        message: `module ${claim.moduleId} claims unknown governed lifecycle position ${JSON.stringify(
          claim.lifecycleState,
        )}; an unparseable position fails closed`,
      });
      continue;
    }
    if (claim.lifecycleState !== 'ACTIVE') continue;
    const failures: string[] = [];
    if (claim.implemented !== true) failures.push('no governed IMPLEMENTED state');
    if (claim.available !== true) failures.push('AVAILABLE was never established');
    // A missing/non-boolean PROVEN requirement is not `false`: it fails closed.
    if (typeof claim.requiresProven !== 'boolean') {
      failures.push('the scope PROVEN requirement is missing or not a boolean');
    } else if (claim.requiresProven && claim.proven !== true) {
      failures.push('PROVEN is required by the scope but was never established');
    }
    if (claim.gateVerdict !== 'PASS') failures.push('no PASS activation-gate evaluation');
    // Only a non-empty string activation event is a reference: an omitted field,
    // `null`, `''`, and whitespace all fail closed (audit R2).
    if (
      typeof claim.activationEventRef !== 'string' ||
      claim.activationEventRef.trim().length === 0
    ) {
      failures.push('no non-empty activation event reference');
    }
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

  // The declared freshness window may only TIGHTEN the authoritative one: a
  // caller override can never keep a stale cell usable (audit H10 residual).
  const maxAgeSeconds = Math.min(
    claim.maxAgeSeconds ?? MCP_LIVE_TEST_MAX_AGE_SECONDS,
    MCP_LIVE_TEST_MAX_AGE_SECONDS,
  );
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
 * The authoritative closed import-artifact quarantine states
 * (`sec.import_artifacts`, FR-SEC-008/§35.14/ADR-046), read from the shared
 * schema rather than restated here. `VALIDATING` and `SHADOW_ELIGIBLE` are the
 * only members a live path may rest in — the closed vocabulary is imported so
 * the shadow subset can never drift from the security-owned machine.
 *
 * The Zod schema owns a mutable `options` array, so the guard reads this
 * frozen COPY of it instead of the third-party array itself: an in-process
 * caller that reaches `ImportQuarantineStateSchema.options` cannot mutate the
 * authority the R7 guard consults (audit NEW-H1).
 */
const ALL_IMPORT_ARTIFACT_STATES: readonly string[] = Object.freeze([
  ...ImportQuarantineStateSchema.options,
]);

/**
 * The only import-artifact states an `IMPORT_SHADOW_ONLY` live-path assertion
 * may certify: a `VALIDATING` or `SHADOW_ELIGIBLE` import. Both are selected
 * from the authoritative closed state set above; an import in any other state
 * (received, quarantined, scanned, rejected) or with no state at all must not
 * pass the release gate (audit H4). The array is frozen so an in-process
 * caller cannot push a non-shadow state into the guard's authority (NEW-H1).
 */
export const SHADOW_ONLY_IMPORT_ARTIFACT_STATES: readonly string[] = Object.freeze(
  ALL_IMPORT_ARTIFACT_STATES.filter(
    (state) => state === 'VALIDATING' || state === 'SHADOW_ELIGIBLE',
  ),
);

/**
 * Render an untrusted import-artifact state for a finding message. The value
 * reaches the rule in-process (never through JSON), so it may be any shape —
 * including a `BigInt`, on which `JSON.stringify` throws, or a pathological
 * object whose `toJSON` AND `toString` both throw. A finding must never become
 * a throw: when JSON serialization is impossible, fall back to the total
 * `String(...)` rendering, and when even that throws, return a stable
 * placeholder. This mirrors the template-string rendering of `undefined` for
 * values JSON drops, so the message stays stable.
 */
function renderImportArtifactState(value: unknown): string {
  try {
    const rendered = JSON.stringify(value);
    return rendered === undefined ? 'undefined' : rendered;
  } catch {
    try {
      return String(value);
    } catch {
      return '<unrenderable>';
    }
  }
}

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
    // `artifactBoundaryHolds` is state-blind: an `IMPORT_SHADOW_ONLY` assertion
    // with `verdict: 'PASS'` certifies only that the assertion was made, not
    // that the referenced import artifact is actually shadow-only. The
    // authoritative quarantine state is therefore checked separately and a
    // missing/null/unknown/RECEIVED/QUARANTINED/SCANNED/REJECTED state refuses
    // the live path (audit H4 root cause). A malformed (non-array) assertion set
    // is a finding instead of a throw.
    const boundaryAssertions: readonly ArtifactBoundaryAssertion[] = Array.isArray(
      claim.boundaryAssertions,
    )
      ? claim.boundaryAssertions
      : [];
    if (!Array.isArray(claim.boundaryAssertions)) {
      report('boundaryAssertions is not an array of assertions; a malformed boundary fails closed');
    }
    if (!artifactBoundaryHolds(boundaryAssertions)) {
      const present = new Set(
        boundaryAssertions.map((assertion) => String(assertion.assertionKind)),
      );
      const missing = ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS.filter((kind) => !present.has(kind));
      const failing = boundaryAssertions.filter((assertion) => assertion.verdict !== 'PASS').length;
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`missing assertions ${missing.join(', ')}`);
      if (failing > 0) parts.push(`${failing} failing assertion(s)`);
      report(
        parts.length > 0
          ? parts.join('; ')
          : 'the live path reaches a heavy job, artifact import, or provider call',
      );
    }
    for (let assertionIndex = 0; assertionIndex < boundaryAssertions.length; assertionIndex += 1) {
      const assertion = boundaryAssertions[assertionIndex];
      if (
        typeof assertion !== 'object' ||
        assertion === null ||
        (assertion as { readonly assertionKind?: unknown }).assertionKind !== 'IMPORT_SHADOW_ONLY'
      ) {
        continue;
      }
      const importState = (assertion as { readonly importArtifactState?: unknown })
        .importArtifactState;
      if (
        typeof importState !== 'string' ||
        !(SHADOW_ONLY_IMPORT_ARTIFACT_STATES as readonly string[]).includes(importState)
      ) {
        report(
          `IMPORT_SHADOW_ONLY must reference an import artifact in ${SHADOW_ONLY_IMPORT_ARTIFACT_STATES.join(
            '/',
          )}; got ${renderImportArtifactState(importState ?? null)}`,
        );
      }
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
  readonly readinessKnown: boolean;
  readonly requiredGateKindsEmpty: boolean;
  /** `releaseRef` was not a non-empty string (a degenerate identity never authorizes). */
  readonly malformedReleaseRef: boolean;
  /** `requiredGateKinds` was not an array (a string is never a gate set). */
  readonly malformedRequiredGateKinds: boolean;
  /** `gateEvidence` was not an array, or an element's `scopeRefs` was not one. */
  readonly malformedGateEvidence: boolean;
  readonly missingGateKinds: readonly string[];
  readonly mismatchedGateKinds: readonly string[];
  readonly revokedOrInvalidGateKinds: readonly string[];
  /** Declared gate kinds outside the authoritative closed `GATE_KINDS` set. */
  readonly unknownGateKinds: readonly string[];
  /** Authoritative mandatory gate kinds the declaration never names. */
  readonly omittedMandatoryGateKinds: readonly string[];
}

const AUTHORIZED_DISTRIBUTION_READINESS: readonly string[] = Object.freeze([
  'WORKSPACE_AUTHORIZED',
  'PUBLIC_AUTHORIZED',
]);
const DEFAULT_PUBLIC_AUTHORIZATION_REQUIREMENT = 'FR-PROD-002';

/**
 * The authoritative mandatory distribution-gate set (audit H2). It is derived
 * from the closed `GATE_KINDS` evidence vocabulary — never from the caller's
 * `requiredGateKinds` — so a truncated or fabricated declaration cannot
 * self-attest a PASS. The evidence checks and `authorized` are evaluated against
 * this set; the caller's declaration is only checked for agreement with it.
 */
const MANDATORY_DISTRIBUTION_GATE_KINDS: readonly string[] = GATE_KINDS;

/**
 * §69.9 law. `WORKSPACE_TECHNICALLY_READY`/`PUBLIC_TECHNICALLY_READY` are
 * honest not-yet-authorized positions; only `*_AUTHORIZED` claims authorization,
 * and only when every AUTHORITATIVE gate kind has a valid, unrevoked,
 * exact-release scoped evidence record and the declaration neither invents a
 * kind nor omits a mandatory one. Technically-ready-without-evidence therefore
 * stays unauthorized (AC-272/273/275/276/277).
 */
export function evaluateDistributionAuthorization(
  claim: DistributionAuthorizationClaim,
): DistributionAuthorizationEvaluation {
  // An unrecognized readiness string is NOT a not-yet-authorized position: it
  // is an unparseable claim and refuses closed (audit H2).
  let readinessKnown = true;
  try {
    parseDistributionReadiness(claim.distributionReadiness);
  } catch {
    readinessKnown = false;
  }
  const readinessAuthorized = AUTHORIZED_DISTRIBUTION_READINESS.includes(
    claim.distributionReadiness,
  );
  const missingGateKinds: string[] = [];
  const mismatchedGateKinds: string[] = [];
  const revokedOrInvalidGateKinds: string[] = [];
  const unknownGateKinds: string[] = [];
  const omittedMandatoryGateKinds: string[] = [];
  // The release identity must be a non-empty string, and the gate set and the
  // evidence list must be real arrays. `scopeRefs` in particular must never be
  // a string: `String.prototype.includes` would substring-match a foreign
  // release ref into scope (audit R3). Every loop below reads numeric indices
  // and object properties directly — never `Array.prototype.filter/some/includes`
  // on a caller-owned array — so an in-process caller cannot shadow those
  // methods and defeat exact-release scoping (the JSON gate cannot do this).
  const releaseRefValid =
    typeof claim.releaseRef === 'string' && claim.releaseRef.trim().length > 0;
  const requiredGateKindsMalformed = !Array.isArray(claim.requiredGateKinds);
  const requiredGateKinds: readonly unknown[] = requiredGateKindsMalformed
    ? []
    : (claim.requiredGateKinds as readonly unknown[]);
  let gateEvidenceMalformed = !Array.isArray(claim.gateEvidence);
  const gateEvidence: readonly unknown[] = gateEvidenceMalformed
    ? []
    : (claim.gateEvidence as readonly unknown[]);
  if (!gateEvidenceMalformed) {
    for (let evidenceIndex = 0; evidenceIndex < gateEvidence.length; evidenceIndex += 1) {
      const evidence = gateEvidence[evidenceIndex];
      if (
        typeof evidence !== 'object' ||
        evidence === null ||
        !Array.isArray((evidence as { readonly scopeRefs?: unknown }).scopeRefs)
      ) {
        gateEvidenceMalformed = true;
        break;
      }
    }
  }
  // An authorization claim with NO required gate kinds is unauthorized by
  // construction: zero requirements cannot be satisfied into a PASS (H2).
  const requiredGateKindsEmpty = readinessAuthorized && requiredGateKinds.length === 0;
  // The caller's declaration is never authoritative: classify every declared
  // kind and record the mandatory kinds it omits, so a fabricated/truncated set
  // can never narrow the evidence bar (audit H2).
  const declaredGateKinds = new Set<string>();
  for (let declaredIndex = 0; declaredIndex < requiredGateKinds.length; declaredIndex += 1) {
    const declared = requiredGateKinds[declaredIndex];
    if (typeof declared !== 'string') {
      unknownGateKinds.push(String(declared));
      continue;
    }
    declaredGateKinds.add(declared);
    if (!(MANDATORY_DISTRIBUTION_GATE_KINDS as readonly string[]).includes(declared)) {
      unknownGateKinds.push(declared);
    }
  }
  for (let gateIndex = 0; gateIndex < MANDATORY_DISTRIBUTION_GATE_KINDS.length; gateIndex += 1) {
    const gateKind = MANDATORY_DISTRIBUTION_GATE_KINDS[gateIndex];
    if (typeof gateKind !== 'string') continue;
    if (!declaredGateKinds.has(gateKind)) {
      omittedMandatoryGateKinds.push(gateKind);
    }
    let sawMatching = false;
    let sawInScope = false;
    let sawUsable = false;
    for (let evidenceIndex = 0; evidenceIndex < gateEvidence.length; evidenceIndex += 1) {
      const evidence = gateEvidence[evidenceIndex];
      if (
        typeof evidence !== 'object' ||
        evidence === null ||
        (evidence as { readonly gateKind?: unknown }).gateKind !== gateKind
      ) {
        continue;
      }
      sawMatching = true;
      const refs = (evidence as { readonly scopeRefs?: unknown }).scopeRefs;
      if (!Array.isArray(refs)) continue;
      let inScope = false;
      for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
        if (refs[refIndex] === claim.releaseRef) {
          inScope = true;
          break;
        }
      }
      if (!inScope) continue;
      sawInScope = true;
      const record = evidence as { readonly valid?: unknown; readonly revokedAt?: unknown };
      if (record.valid === true && (record.revokedAt === undefined || record.revokedAt === null)) {
        sawUsable = true;
      }
    }
    if (!sawMatching) missingGateKinds.push(gateKind);
    else if (!sawInScope) mismatchedGateKinds.push(gateKind);
    else if (!sawUsable) revokedOrInvalidGateKinds.push(gateKind);
  }
  return {
    authorized:
      releaseRefValid &&
      readinessKnown &&
      readinessAuthorized &&
      !requiredGateKindsMalformed &&
      !gateEvidenceMalformed &&
      !requiredGateKindsEmpty &&
      unknownGateKinds.length === 0 &&
      omittedMandatoryGateKinds.length === 0 &&
      missingGateKinds.length === 0 &&
      mismatchedGateKinds.length === 0 &&
      revokedOrInvalidGateKinds.length === 0,
    readinessAuthorized,
    readinessKnown,
    requiredGateKindsEmpty,
    malformedReleaseRef: !releaseRefValid,
    malformedRequiredGateKinds: requiredGateKindsMalformed,
    malformedGateEvidence: gateEvidenceMalformed,
    missingGateKinds,
    mismatchedGateKinds,
    revokedOrInvalidGateKinds,
    unknownGateKinds,
    omittedMandatoryGateKinds,
  };
}

/** Flag every `*_AUTHORIZED` claim whose exact-release evidence set is incomplete. */
export function checkPublicAuthorizationWithoutGateEvidence(
  claims: readonly DistributionAuthorizationClaim[],
): ProdRuleReport {
  const findings: ProdConformanceFinding[] = [];
  // Numeric-index iteration (never `for…of`): see `checkActivationWithoutEvidence`.
  for (let claimIndex = 0; claimIndex < claims.length; claimIndex += 1) {
    const claim = claims[claimIndex];
    if (claim === undefined || claim === null) {
      findings.push({
        requirementId: DEFAULT_PUBLIC_AUTHORIZATION_REQUIREMENT,
        rule: PROD_RULES.publicAuthorizationWithoutGateEvidence,
        path: `distributionAuthorizations[${claimIndex}]`,
        message: `distributionAuthorizations[${claimIndex}] is not a claim object; a malformed claim fails closed`,
      });
      continue;
    }
    const evaluation = evaluateDistributionAuthorization(claim);
    if (!evaluation.readinessKnown) {
      findings.push({
        requirementId: claim.requirementId ?? DEFAULT_PUBLIC_AUTHORIZATION_REQUIREMENT,
        rule: PROD_RULES.publicAuthorizationWithoutGateEvidence,
        path: claim.releaseRef,
        message: `unknown distribution readiness ${JSON.stringify(
          claim.distributionReadiness,
        )}: an unparseable claim fails closed`,
      });
      continue;
    }
    if (!evaluation.readinessAuthorized || evaluation.authorized) continue;
    const requirementId = claim.requirementId ?? DEFAULT_PUBLIC_AUTHORIZATION_REQUIREMENT;
    const details: string[] = [];
    if (evaluation.requiredGateKindsEmpty) {
      details.push(
        'no required gate kinds were declared (an empty requirement set cannot authorize)',
      );
    }
    if (evaluation.malformedRequiredGateKinds) {
      details.push('requiredGateKinds is not an array (a gate set must be declared as an array)');
    }
    if (evaluation.malformedReleaseRef) {
      details.push(
        'releaseRef is not a non-empty string (a degenerate release identity cannot authorize)',
      );
    }
    if (evaluation.malformedGateEvidence) {
      details.push(
        'gateEvidence is not an array of records, or an evidence scopeRefs is not an array of release refs',
      );
    }
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
    if (evaluation.omittedMandatoryGateKinds.length > 0) {
      details.push(
        `authoritative mandatory gate kinds omitted from the declaration: ${evaluation.omittedMandatoryGateKinds.join(', ')}`,
      );
    }
    if (evaluation.unknownGateKinds.length > 0) {
      details.push(
        `declared gate kinds outside the authoritative set: ${evaluation.unknownGateKinds.join(', ')}`,
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
 * The mandatory release-gate inputs. Each is REQUIRED: omitting one is a
 * conformance finding, never a silent skip (audit H2). An explicit empty array
 * is a declaration that there are no such claims and is allowed.
 */
const REQUIRED_PROD_INPUTS = [
  ['activationClaims', 'ACTIVATION_CLAIMS'],
  ['postureDeclarations', 'POSTURE_DECLARATIONS'],
  ['mcpCompatibility', 'MCP_COMPATIBILITY'],
  ['livePaths', 'LIVE_PATHS'],
  ['distributionAuthorizations', 'DISTRIBUTION_AUTHORIZATIONS'],
] as const;

/**
 * The fields each claim element must carry for its rule to be evaluable. A
 * malformed element (a bare string, or an object missing its discriminant) is
 * reported as an input finding rather than silently skipped (audit H2
 * element-shape residual).
 */
const REQUIRED_CLAIM_FIELDS: Readonly<Record<string, readonly string[]>> = {
  activationClaims: ['moduleId', 'lifecycleState'],
  postureDeclarations: ['declarationId', 'posture', 'weakenedDimensions', 'protectedDimensions'],
  livePaths: ['livePath', 'now', 'request', 'boundaryAssertions'],
  distributionAuthorizations: [
    'releaseRef',
    'distributionReadiness',
    'requiredGateKinds',
    'gateEvidence',
  ],
};

/** The mcpCompatibility claim's mandatory collections plus its instant. */
const REQUIRED_MCP_FIELDS = ['revisions', 'clients', 'cells'] as const;

/**
 * True only when the MCP claim has the collections and instant its rule reads.
 * A malformed claim is already reported by `checkProdConformanceInputsPresent`;
 * running the rule over it would only throw.
 */
function mcpClaimWellShaped(value: unknown): value is McpCompatibilityMatrixClaim {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const claim = value as Record<string, unknown>;
  return (
    Array.isArray(claim['revisions']) &&
    Array.isArray(claim['clients']) &&
    Array.isArray(claim['cells']) &&
    typeof claim['now'] === 'string' &&
    claim['now'].length > 0
  );
}

/** Flag every mandatory input the caller omitted instead of declaring. */
export function checkProdConformanceInputsPresent(input: ProdConformanceInput): ProdRuleReport {
  const findings: ProdConformanceFinding[] = [];
  for (const [field, label] of REQUIRED_PROD_INPUTS) {
    const value: unknown = input[field];
    // Omission (`undefined`/`null`) AND a malformed value (anything that is not
    // the declared shape) both fail closed: a string is iterable, so
    // `for (const c of "")` would iterate zero times and silently pass the five
    // claim rules (audit H2 residual).
    const wellShaped =
      field === 'mcpCompatibility'
        ? typeof value === 'object' && value !== null && !Array.isArray(value)
        : Array.isArray(value);
    if (!wellShaped) {
      findings.push({
        requirementId: 'FR-PROD-001',
        rule: PROD_RULES.prodConformanceInputMissing,
        path: field,
        message: `PROD conformance input ${field} (${label}) was omitted or was not the declared ${field === 'mcpCompatibility' ? 'object' : 'array'} shape; an absent or malformed governance claim set fails the release gate closed instead of passing vacuously`,
      });
      continue;
    }
    // Element shape: a malformed element must be a finding, not a silent skip.
    if (field === 'mcpCompatibility') {
      const claim = value as Record<string, unknown>;
      for (const required of REQUIRED_MCP_FIELDS) {
        if (!Array.isArray(claim[required])) {
          findings.push({
            requirementId: 'FR-PROD-001',
            rule: PROD_RULES.prodConformanceInputMissing,
            path: `${field}.${required}`,
            message: `MCP compatibility claim ${required} must be an array; a malformed claim set fails the release gate closed`,
          });
        }
      }
      if (typeof claim['now'] !== 'string' || claim['now'].length === 0) {
        findings.push({
          requirementId: 'FR-PROD-001',
          rule: PROD_RULES.prodConformanceInputMissing,
          path: `${field}.now`,
          message: 'MCP compatibility claim now must be a non-empty instant',
        });
      }
      continue;
    }
    const requiredFields = REQUIRED_CLAIM_FIELDS[field] ?? [];
    const elements = value as readonly unknown[];
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      if (typeof element !== 'object' || element === null || Array.isArray(element)) {
        findings.push({
          requirementId: 'FR-PROD-001',
          rule: PROD_RULES.prodConformanceInputMissing,
          path: `${field}[${index}]`,
          message: `${field}[${index}] is not a claim object; a malformed claim set fails the release gate closed`,
        });
        continue;
      }
      const claim = element as Record<string, unknown>;
      for (const required of requiredFields) {
        if (claim[required] === undefined || claim[required] === null) {
          findings.push({
            requirementId: 'FR-PROD-001',
            rule: PROD_RULES.prodConformanceInputMissing,
            path: `${field}[${index}].${required}`,
            message: `${field}[${index}] is missing the required field ${required}; a malformed claim fails the release gate closed`,
          });
        }
      }
      // Nested shape: a field that must be an array (or an exact nullable
      // string) is validated too, so a string cannot stand in for a collection
      // and substring-match its way to an authorization (audit R2/R3).
      if (field === 'activationClaims') {
        if (typeof claim['requiresProven'] !== 'boolean') {
          findings.push({
            requirementId: 'FR-PROD-001',
            rule: PROD_RULES.prodConformanceInputMissing,
            path: `${field}[${index}].requiresProven`,
            message: `${field}[${index}].requiresProven must be a boolean; a missing or stringly PROVEN requirement fails the release gate closed`,
          });
        }
        const eventRef = claim['activationEventRef'];
        if (
          !('activationEventRef' in claim) ||
          (eventRef !== null && (typeof eventRef !== 'string' || eventRef.trim().length === 0))
        ) {
          findings.push({
            requirementId: 'FR-PROD-001',
            rule: PROD_RULES.prodConformanceInputMissing,
            path: `${field}[${index}].activationEventRef`,
            message: `${field}[${index}].activationEventRef must be a non-empty string or null; an omitted, empty, or non-string activation event fails the release gate closed`,
          });
        }
      }
      if (field === 'distributionAuthorizations') {
        if (!Array.isArray(claim['requiredGateKinds'])) {
          findings.push({
            requirementId: 'FR-PROD-001',
            rule: PROD_RULES.prodConformanceInputMissing,
            path: `${field}[${index}].requiredGateKinds`,
            message: `${field}[${index}].requiredGateKinds must be an array of gate kinds`,
          });
        }
        if (!Array.isArray(claim['gateEvidence'])) {
          findings.push({
            requirementId: 'FR-PROD-001',
            rule: PROD_RULES.prodConformanceInputMissing,
            path: `${field}[${index}].gateEvidence`,
            message: `${field}[${index}].gateEvidence must be an array of evidence records`,
          });
        } else {
          const evidenceList = claim['gateEvidence'] as readonly unknown[];
          for (let evidenceIndex = 0; evidenceIndex < evidenceList.length; evidenceIndex += 1) {
            const evidence = evidenceList[evidenceIndex];
            const scopeRefs =
              typeof evidence === 'object' && evidence !== null
                ? (evidence as Record<string, unknown>)['scopeRefs']
                : undefined;
            if (!Array.isArray(scopeRefs)) {
              findings.push({
                requirementId: 'FR-PROD-001',
                rule: PROD_RULES.prodConformanceInputMissing,
                path: `${field}[${index}].gateEvidence[${evidenceIndex}].scopeRefs`,
                message: `${field}[${index}].gateEvidence[${evidenceIndex}].scopeRefs must be an array of release refs; a string scopeRefs cannot be substring-matched into scope`,
              });
            }
          }
        }
      }
    }
  }
  return { passed: findings.length === 0, findings };
}

/**
 * Evaluate every PROD rule and aggregate the findings into one report whose
 * shape matches `ConformanceResult`. `overall` is `FAILED` when any finding was
 * produced — including the finding emitted for each OMITTED mandatory input, so
 * `evaluateProdConformance({})` can never be a vacuous PASS (audit H2).
 */
export function evaluateProdConformance(input: ProdConformanceInput): ProdConformanceReport {
  const findings: ProdConformanceFinding[] = [
    ...checkProdConformanceInputsPresent(input).findings,
    ...checkActivationWithoutEvidence(
      Array.isArray(input.activationClaims) ? input.activationClaims : [],
    ).findings,
    ...checkPostureWeakening(
      Array.isArray(input.postureDeclarations) ? input.postureDeclarations : [],
    ).findings,
    ...(mcpClaimWellShaped(input.mcpCompatibility)
      ? checkMcpCompatibilityDrift(input.mcpCompatibility).findings
      : []),
    ...checkLivePathPrecomputationViolation(Array.isArray(input.livePaths) ? input.livePaths : [])
      .findings,
    ...checkPublicAuthorizationWithoutGateEvidence(
      Array.isArray(input.distributionAuthorizations) ? input.distributionAuthorizations : [],
    ).findings,
  ];
  return { overall: findings.length === 0 ? 'PASSED' : 'FAILED', findings };
}

// --- repo-backed PROD surface bridge (audit H1) ------------------------------

/** The mapping fields the repo-backed bridge resolves for every FR-PROD item. */
const PROD_SURFACE_FIELDS = [
  'implementationRefs',
  'schemaRefs',
  'persistenceRefs',
  'telemetryRefs',
  'fixtureRefs',
  'apiToolUiRefs',
  'testRefs',
] as const;

/** A lightweight requirement record; only the mapping fields are read. */
export interface ProdSurfaceRequirement {
  readonly id: string;
  readonly supersededBy?: readonly string[];
  readonly implementationRefs?: readonly string[];
  readonly schemaRefs?: readonly string[];
  readonly persistenceRefs?: readonly string[];
  readonly telemetryRefs?: readonly string[];
  readonly fixtureRefs?: readonly string[];
  readonly apiToolUiRefs?: readonly string[];
  readonly testRefs?: readonly string[];
}

export interface ProdSurfacePresenceOptions {
  readonly repoRoot: string;
  readonly requirements?: readonly ProdSurfaceRequirement[];
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]')
    .replaceAll('\u0000', '.*');
  return new RegExp(`^${body}$`);
}

async function filesUnder(root: string, relative = ''): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(path.join(root, relative), { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const child = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await filesUnder(root, child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

/** True when a declared ref (exact path, directory, or glob) resolves on disk. */
async function prodRefResolves(repoRoot: string, ref: string): Promise<boolean> {
  const clean = implementationPath(ref);
  if (clean.length === 0) return false;
  const wildcard = clean.search(/[?*[{]/);
  if (wildcard < 0) {
    try {
      await access(path.join(repoRoot, clean));
      return true;
    } catch {
      return false;
    }
  }
  const beforeWildcard = clean.slice(0, wildcard);
  const lastSlash = beforeWildcard.lastIndexOf('/');
  const prefix = lastSlash < 0 ? '' : beforeWildcard.slice(0, lastSlash);
  const rest = lastSlash < 0 ? clean : clean.slice(lastSlash + 1);
  const matcher = globToRegExp(rest);
  return (await filesUnder(path.join(repoRoot, prefix))).some((file) => matcher.test(file));
}

/**
 * Repo-backed bridge for the PROD family (audit H1): every declared
 * implementation/schema/persistence/telemetry/fixture/api/test ref of every
 * non-superseded FR-PROD requirement must resolve in the LIVE tree, resolved
 * through the canonical `resolveMappings` + `implementationPath` path. A tree
 * that drops a prod surface therefore FAILS the release gate instead of passing
 * because nobody looked.
 */
export async function checkProdSurfacePresence(
  options: ProdSurfacePresenceOptions,
): Promise<ProdRuleReport> {
  const requirements =
    options.requirements ??
    (JSON.parse(
      await readFile(
        path.join(
          options.repoRoot,
          'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
        ),
        'utf8',
      ),
    ).requirements as readonly ProdSurfaceRequirement[]);
  const findings: ProdConformanceFinding[] = [];
  for (const requirement of requirements) {
    if (!requirement.id.startsWith('FR-PROD-')) continue;
    if ((requirement.supersededBy ?? []).length > 0) continue;
    const mappings = resolveMappings({ requirements }, requirement.id);
    for (const field of PROD_SURFACE_FIELDS) {
      for (const ref of mappings[field]) {
        if (await prodRefResolves(options.repoRoot, ref)) continue;
        findings.push({
          requirementId: requirement.id,
          rule: PROD_RULES.prodSurfaceMissing,
          path: implementationPath(ref),
          message: `${requirement.id} declares ${field} ${implementationPath(ref)} but it does not resolve in the live repository`,
        });
      }
    }
  }
  return { passed: findings.length === 0, findings };
}
