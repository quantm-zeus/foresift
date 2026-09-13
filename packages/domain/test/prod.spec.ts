/**
 * Production-readiness domain vocabulary and pure-law suite
 * (T005, FR-PROD-001…006, PRD §32, §33.7, §40, §69.2–§69.12).
 *
 * Pins the §69.2 nine-state governed lifecycle seeded from `NOT_IMPLEMENTED`,
 * the operational/distribution readiness vocabularies, the
 * IMPLEMENTED/AVAILABLE/PROVEN independence law, legal lifecycle transitions,
 * the total ordered activation prerequisite and gate predicates, §40
 * dependency-group ordering, the §69.6 protected-dimension refusal, §69.12
 * change classification, §69.7 MCP default/cell laws, §33.7 precomputed bounds,
 * the §10.3/§35.14 trust-boundary verdict, and fail-closed parsing of every
 * unknown literal.
 */
import { describe, expect, it } from 'bun:test';
import { ErrorCode, ForesiftError } from '../src/errors.ts';
import {
  ACTIVATION_GATE_ORDER,
  ALL_ACTIVATION_GATE_KINDS,
  ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS,
  ALL_CHANGE_CLASSIFICATIONS,
  ALL_CONTAINMENT_ACTIONS,
  ALL_DEPENDENCY_GROUP_IDS,
  ALL_DEPLOYMENT_POSTURES,
  ALL_DEPLOYMENT_RELAXABLE_DIMENSIONS,
  ALL_DISTRIBUTION_READINESS,
  ALL_MCP_REVISION_CHANNELS,
  ALL_MODULE_LIFECYCLE_POSITIONS,
  ALL_MODULE_LIFECYCLE_STATES,
  ALL_OPERATIONAL_READINESS,
  ALL_PROTECTED_DIMENSIONS,
  ActivationGateKind,
  ActivationGateVerdict,
  ArtifactBoundaryAssertionKind,
  ChangeClassification,
  DEPENDENCY_GROUP_ORDER,
  DeploymentPosture,
  DeploymentRelaxableDimension,
  DistributionReadiness,
  MCP_BASELINE_STABLE_REVISION,
  MCP_LIVE_TEST_MAX_AGE_SECONDS,
  McpConformanceResult,
  McpRevisionChannel,
  ModuleLifecycleState,
  OperationalReadiness,
  ProtectedDimension,
  activationGateRefusal,
  activationGateSatisfied,
  artifactBoundaryHolds,
  assertActivationGateSatisfied,
  assertArtifactBoundaryHolds,
  assertBestEffortPreservesProtectedDimensions,
  assertDependencyGroupOrder,
  assertLegalLifecycleTransition,
  assertNoDraftDefault,
  assertPrecomputedAlphaRequestWithinBound,
  bestEffortWeakensOnlyAllowedDimensions,
  changeClassificationBlocksActivation,
  changeClassificationRequiresShadow,
  dependencyGroupCompletionActivatesOpportunities,
  dependencyGroupIndex,
  dependencyGroupOrderAllowed,
  isIndependentLifecycleState,
  legalLifecycleTransition,
  mcpCompatibilityCellUsable,
  mcpRevisionMayBeDefault,
  parseActivationGateKind,
  parseModuleLifecycleState,
  precomputedAlphaBoundRespected,
  requiredStatesForActivation,
  trustBoundaryVerdict,
} from '../src/index.ts';

const HASH = `sha256:${'a'.repeat(64)}`;

const SCOPE = {
  profileVersion: 'profile-v1',
  policyVersion: 'policy-v1',
  regimeScope: 'regime-v1',
  executionScenario: 'scenario-v1',
  delayPolicy: 'delay-v1',
  populationClaim: 'population-v1',
} as const;

function expectCode(fn: () => unknown, code: ErrorCode): ForesiftError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ForesiftError);
  const foresiftError = caught as ForesiftError;
  expect(foresiftError.code).toBe(code);
  return foresiftError;
}

describe('§69.2 governed module lifecycle vocabulary', () => {
  it('lists the nine governed states verbatim and in order', () => {
    expect([...ALL_MODULE_LIFECYCLE_STATES]).toEqual([
      'IMPLEMENTED',
      'AVAILABLE',
      'SHADOW',
      'PROVEN',
      'ACTIVE',
      'DEGRADED',
      'PAUSED',
      'RETIRED',
      'DISABLED',
    ]);
  });

  it('seeds the lattice from NOT_IMPLEMENTED with the nine states appended', () => {
    expect([...ALL_MODULE_LIFECYCLE_POSITIONS]).toEqual([
      'NOT_IMPLEMENTED',
      ...ALL_MODULE_LIFECYCLE_STATES,
    ]);
    // The seed is never a governed state row value.
    expect((ALL_MODULE_LIFECYCLE_STATES as readonly string[]).includes('NOT_IMPLEMENTED')).toBe(
      false,
    );
  });

  it('separates operational and distribution readiness vocabularies', () => {
    expect([...ALL_OPERATIONAL_READINESS]).toEqual([
      'NOT_READY',
      'READY_FOR_COLLECTION',
      'READY_FOR_SHADOW_RESEARCH',
      'READY_FOR_SHADOW_ALERTS',
      'READY_FOR_ACTIVE_PROFILE',
    ]);
    expect([...ALL_DISTRIBUTION_READINESS]).toEqual([
      'PRIVATE_ONLY',
      'WORKSPACE_TECHNICALLY_READY',
      'WORKSPACE_AUTHORIZED',
      'PUBLIC_TECHNICALLY_READY',
      'PUBLIC_AUTHORIZED',
    ]);
    expect(OperationalReadiness.NOT_READY).not.toBe(DistributionReadiness.PRIVATE_ONLY);
  });

  it('pins the remaining closed vocabularies', () => {
    expect([...ALL_DEPLOYMENT_POSTURES]).toEqual(['SLA_BACKED', 'FREE_TIER_BEST_EFFORT']);
    expect([...ALL_CHANGE_CLASSIFICATIONS]).toEqual([
      'NON_MATERIAL_COMPATIBLE',
      'MATERIAL_OPERATIONAL',
      'MATERIAL_EVALUATION',
      'MATERIAL_SECURITY_OR_RIGHTS',
    ]);
    expect([...ALL_CONTAINMENT_ACTIONS]).toEqual(['DEGRADED', 'PAUSED', 'DISABLED']);
    expect([...ALL_MCP_REVISION_CHANNELS]).toEqual(['STABLE', 'DRAFT']);
    expect([...ALL_PROTECTED_DIMENSIONS]).toEqual([
      'identity',
      'point_in_time',
      'audit',
      'duplicate_prevention',
      'security',
      'execution_semantics',
      'capacity',
      'critical_risk_monitoring',
      'claim_boundaries',
    ]);
    expect([...ALL_DEPLOYMENT_RELAXABLE_DIMENSIONS]).toEqual([
      'freshness',
      'breadth',
      'depth',
      'alert_availability',
    ]);
    expect([...ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS]).toEqual([
      'NO_HEAVY_JOB',
      'NO_IMPORT',
      'NO_PROVIDER_CALL',
      'IMPORT_SHADOW_ONLY',
    ]);
    expect([...ALL_DEPENDENCY_GROUP_IDS]).toEqual(['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']);
  });

  it('refuses every unknown literal fail-closed', () => {
    expectCode(() => parseModuleLifecycleState('DEPLOYED'), ErrorCode.PROD_MODULE_STATE_UNKNOWN);
    expectCode(
      () => parseModuleLifecycleState('NOT_IMPLEMENTED'),
      ErrorCode.PROD_MODULE_STATE_UNKNOWN,
    );
    expectCode(
      () => parseActivationGateKind('LOOKS_FINE'),
      ErrorCode.PROD_ACTIVATION_GATE_KIND_UNKNOWN,
    );
  });
});

describe('FR-PROD-001 independent lifecycle dimensions', () => {
  it('marks exactly IMPLEMENTED, AVAILABLE, and PROVEN as independent', () => {
    expect(isIndependentLifecycleState(ModuleLifecycleState.IMPLEMENTED)).toBe(true);
    expect(isIndependentLifecycleState(ModuleLifecycleState.AVAILABLE)).toBe(true);
    expect(isIndependentLifecycleState(ModuleLifecycleState.PROVEN)).toBe(true);
    expect(isIndependentLifecycleState(ModuleLifecycleState.ACTIVE)).toBe(false);
    expect(isIndependentLifecycleState(ModuleLifecycleState.SHADOW)).toBe(false);
    expect(isIndependentLifecycleState(ModuleLifecycleState.DISABLED)).toBe(false);
  });

  it('refuses an unknown state rather than treating it as independent', () => {
    expectCode(() => isIndependentLifecycleState('FAILED'), ErrorCode.PROD_MODULE_STATE_UNKNOWN);
  });
});

describe('§69.2/§69.3 legal lifecycle transitions', () => {
  it('admits the seed and the forward gate-path edges', () => {
    expect(legalLifecycleTransition('NOT_IMPLEMENTED', 'IMPLEMENTED')).toBe(true);
    expect(legalLifecycleTransition('IMPLEMENTED', 'AVAILABLE')).toBe(true);
    expect(legalLifecycleTransition('AVAILABLE', 'SHADOW')).toBe(true);
    expect(legalLifecycleTransition('SHADOW', 'PROVEN')).toBe(true);
    expect(legalLifecycleTransition('PROVEN', 'ACTIVE')).toBe(true);
  });

  it('refuses skips, self-transitions, and unknown literals', () => {
    expect(legalLifecycleTransition('IMPLEMENTED', 'PROVEN')).toBe(false);
    expect(legalLifecycleTransition('IMPLEMENTED', 'ACTIVE')).toBe(false);
    expect(legalLifecycleTransition('ACTIVE', 'ACTIVE')).toBe(false);
    expectCode(
      () => assertLegalLifecycleTransition('IMPLEMENTED', 'ACTIVE'),
      ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
    );
    expectCode(
      () => assertLegalLifecycleTransition('IMPLEMENTED', 'NOPE'),
      ErrorCode.PROD_MODULE_STATE_UNKNOWN,
    );
  });

  it('keeps a contained module unable to self-promote straight back to ACTIVE', () => {
    expect(legalLifecycleTransition('DISABLED', 'ACTIVE')).toBe(false);
    expect(legalLifecycleTransition('DISABLED', 'IMPLEMENTED')).toBe(true);
    expect(legalLifecycleTransition('DISABLED', 'PROVEN')).toBe(true);
  });
});

describe('§69.5 ordered activation prerequisites', () => {
  it('requires IMPLEMENTED then AVAILABLE and only conditionally PROVEN', () => {
    expect(
      requiredStatesForActivation({ ...SCOPE, requiresProven: false }, [
        ActivationGateKind.IMPLEMENTED_PRESENT,
        ActivationGateKind.AVAILABLE_EVIDENCE,
      ]),
    ).toEqual(['IMPLEMENTED', 'AVAILABLE']);
    expect(
      requiredStatesForActivation({ ...SCOPE, requiresProven: true }, [
        ActivationGateKind.IMPLEMENTED_PRESENT,
        ActivationGateKind.AVAILABLE_EVIDENCE,
        ActivationGateKind.PROVEN_PRESENT,
      ]),
    ).toEqual(['IMPLEMENTED', 'AVAILABLE', 'PROVEN']);
  });

  it('refuses a scope whose PROVEN flag and gate schedule contradict', () => {
    expectCode(
      () =>
        requiredStatesForActivation({ ...SCOPE, requiresProven: true }, [
          ActivationGateKind.IMPLEMENTED_PRESENT,
        ]),
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
    );
    expectCode(
      () =>
        requiredStatesForActivation({ ...SCOPE, requiresProven: false }, [
          ActivationGateKind.PROVEN_PRESENT,
        ]),
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
    );
  });

  it('refuses an empty scope field and an unknown gate', () => {
    expectCode(
      () =>
        requiredStatesForActivation({ ...SCOPE, profileVersion: '', requiresProven: false }, []),
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
    );
    expectCode(
      () =>
        requiredStatesForActivation({ ...SCOPE, requiresProven: false }, [
          'MADE_UP',
        ] as unknown as readonly ActivationGateKind[]),
      ErrorCode.PROD_ACTIVATION_GATE_KIND_UNKNOWN,
    );
  });
});

describe('§69.4/§69.5 ordered fail-closed activation predicate', () => {
  const gateOrder = ACTIVATION_GATE_ORDER;
  const passAll = (skip?: ActivationGateKind) =>
    gateOrder
      .filter((gate) => gate !== skip)
      .map((gate) => ({
        gateKind: gate,
        verdict: ActivationGateVerdict.PASS,
        failingGate: null,
      }));

  it('passes only a complete, consistent, all-PASS gate set', () => {
    expect(ACTIVATION_GATE_ORDER.length).toBe(ALL_ACTIVATION_GATE_KINDS.length);
    expect(activationGateRefusal(passAll())).toBeNull();
    expect(activationGateSatisfied(passAll())).toBe(true);
    expect(() => assertActivationGateSatisfied(passAll())).not.toThrow();
  });

  it('fails closed on a missing gate and names it in order', () => {
    const missing = passAll(ActivationGateKind.PROVEN_PRESENT);
    expect(activationGateRefusal(missing)).toBe(ActivationGateKind.PROVEN_PRESENT);
    expect(activationGateSatisfied(missing)).toBe(false);
  });

  it('refuses a refused gate and an internally inconsistent PASS', () => {
    const refused = passAll().map((evaluation) =>
      evaluation.gateKind === ActivationGateKind.CAPACITY_CONTRACT
        ? {
            gateKind: evaluation.gateKind,
            verdict: ActivationGateVerdict.REFUSE,
            failingGate: ActivationGateKind.CAPACITY_CONTRACT,
          }
        : evaluation,
    );
    expect(activationGateRefusal(refused)).toBe(ActivationGateKind.CAPACITY_CONTRACT);

    const inconsistent = passAll().map((evaluation) =>
      evaluation.gateKind === ActivationGateKind.NEGATIVE_CONTROLS
        ? {
            gateKind: evaluation.gateKind,
            verdict: ActivationGateVerdict.PASS,
            failingGate: ActivationGateKind.NEGATIVE_CONTROLS,
          }
        : evaluation,
    );
    expect(activationGateRefusal(inconsistent)).toBe(ActivationGateKind.NEGATIVE_CONTROLS);
  });

  it('refuses a duplicated gate and an unknown gate literal', () => {
    const duplicated = [...passAll(), { ...passAll()[0] }];
    expect(activationGateRefusal(duplicated)).not.toBeNull();
    expectCode(
      () => activationGateRefusal([{ gateKind: 'IMAGINARY', verdict: 'PASS', failingGate: null }]),
      ErrorCode.PROD_ACTIVATION_GATE_KIND_UNKNOWN,
    );
    expectCode(
      () => assertActivationGateSatisfied(passAll(ActivationGateKind.IMPLEMENTED_PRESENT)),
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
    );
  });

  it('supports a scope-specific required subset', () => {
    const subset = [ActivationGateKind.IMPLEMENTED_PRESENT, ActivationGateKind.AVAILABLE_EVIDENCE];
    expect(
      activationGateSatisfied(
        [{ gateKind: ActivationGateKind.IMPLEMENTED_PRESENT, verdict: 'PASS', failingGate: null }],
        subset,
      ),
    ).toBe(false);
    expect(
      activationGateSatisfied(
        subset.map((gate) => ({ gateKind: gate, verdict: 'PASS', failingGate: null })),
        subset,
      ),
    ).toBe(true);
  });
});

describe('§40 dependency-group ordering', () => {
  it('orders G0…G7 and allows only forward edges', () => {
    expect([...DEPENDENCY_GROUP_ORDER]).toEqual([...ALL_DEPENDENCY_GROUP_IDS]);
    expect(dependencyGroupIndex('G0')).toBe(0);
    expect(dependencyGroupIndex('G7')).toBe(7);
    expect(dependencyGroupOrderAllowed('G0', 'G3')).toBe(true);
    expect(dependencyGroupOrderAllowed('G3', 'G0')).toBe(false);
    expect(dependencyGroupOrderAllowed('G2', 'G2')).toBe(false);
    expect(() => assertDependencyGroupOrder('G1', 'G4')).not.toThrow();
    expectCode(
      () => assertDependencyGroupOrder('G4', 'G1'),
      ErrorCode.PROD_DEPENDENCY_ORDER_VIOLATED,
    );
    expectCode(() => dependencyGroupIndex('G9'), ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN);
  });

  it('never lets group completion activate opportunities (§40)', () => {
    expect(dependencyGroupCompletionActivatesOpportunities()).toBe(false);
  });
});

describe('§69.6 best-effort posture law', () => {
  it('accepts a best-effort declaration that relaxes only allowed dimensions', () => {
    expect(
      bestEffortWeakensOnlyAllowedDimensions({
        posture: DeploymentPosture.FREE_TIER_BEST_EFFORT,
        weakenedDimensions: [
          DeploymentRelaxableDimension.FRESHNESS,
          DeploymentRelaxableDimension.ALERT_AVAILABILITY,
        ],
        protectedDimensions: ALL_PROTECTED_DIMENSIONS,
      }),
    ).toBe(true);
  });

  it('refuses any intersection with a protected dimension', () => {
    const declaration = {
      posture: DeploymentPosture.FREE_TIER_BEST_EFFORT,
      weakenedDimensions: [ProtectedDimension.AUDIT],
      protectedDimensions: ALL_PROTECTED_DIMENSIONS,
    };
    expect(bestEffortWeakensOnlyAllowedDimensions(declaration)).toBe(false);
    expectCode(
      () => assertBestEffortPreservesProtectedDimensions(declaration),
      ErrorCode.PROD_BEST_EFFORT_PROTECTED_DIMENSION,
    );
  });

  it('refuses an SLA_BACKED posture that declares weakening', () => {
    expect(
      bestEffortWeakensOnlyAllowedDimensions({
        posture: DeploymentPosture.SLA_BACKED,
        weakenedDimensions: [DeploymentRelaxableDimension.BREADTH],
        protectedDimensions: ALL_PROTECTED_DIMENSIONS,
      }),
    ).toBe(false);
  });

  it('refuses an unknown dimension and an unknown posture fail-closed', () => {
    expectCode(
      () =>
        bestEffortWeakensOnlyAllowedDimensions({
          posture: DeploymentPosture.FREE_TIER_BEST_EFFORT,
          weakenedDimensions: ['vibes'],
          protectedDimensions: [],
        }),
      ErrorCode.PROD_RELAXABLE_DIMENSION_UNKNOWN,
    );
    expectCode(
      () =>
        bestEffortWeakensOnlyAllowedDimensions({
          posture: 'BEST_EFFORT',
          weakenedDimensions: [],
          protectedDimensions: [],
        }),
      ErrorCode.PROD_DEPLOYMENT_POSTURE_UNKNOWN,
    );
  });
});

describe('§69.12 change classification law', () => {
  it('requires new shadow evidence for material operational/evaluation changes', () => {
    expect(changeClassificationRequiresShadow(ChangeClassification.MATERIAL_OPERATIONAL)).toBe(
      true,
    );
    expect(changeClassificationRequiresShadow(ChangeClassification.MATERIAL_EVALUATION)).toBe(true);
    expect(changeClassificationRequiresShadow(ChangeClassification.NON_MATERIAL_COMPATIBLE)).toBe(
      false,
    );
    expect(
      changeClassificationRequiresShadow(ChangeClassification.MATERIAL_SECURITY_OR_RIGHTS),
    ).toBe(false);
  });

  it('blocks activation for material security/rights changes only', () => {
    expect(
      changeClassificationBlocksActivation(ChangeClassification.MATERIAL_SECURITY_OR_RIGHTS),
    ).toBe(true);
    expect(changeClassificationBlocksActivation(ChangeClassification.MATERIAL_OPERATIONAL)).toBe(
      false,
    );
    expectCode(
      () => changeClassificationRequiresShadow('MATERIAL_VIBES'),
      ErrorCode.PROD_CHANGE_CLASSIFICATION_UNKNOWN,
    );
  });
});

describe('§69.7 MCP compatibility law', () => {
  const now = '2026-06-01T00:00:00Z';

  it('defaults only to a stable revision and knows the baseline', () => {
    expect(MCP_BASELINE_STABLE_REVISION).toBe('2025-11-25');
    expect(
      mcpRevisionMayBeDefault({
        revision: MCP_BASELINE_STABLE_REVISION,
        channel: McpRevisionChannel.STABLE,
        isDefault: true,
      }),
    ).toBe(true);
    expect(
      mcpRevisionMayBeDefault({
        revision: '2026-01-01-rc.1',
        channel: McpRevisionChannel.DRAFT,
        isDefault: true,
      }),
    ).toBe(false);
    expect(
      mcpRevisionMayBeDefault({
        revision: '2026-01-01-rc.1',
        channel: McpRevisionChannel.DRAFT,
        isDefault: false,
      }),
    ).toBe(false);
    expectCode(
      () =>
        assertNoDraftDefault([
          { revision: '2026-01-01-rc.1', channel: McpRevisionChannel.DRAFT, isDefault: true },
        ]),
      ErrorCode.PROD_MCP_DRAFT_DEFAULT,
    );
  });

  it('marks failing and stale cells unusable', () => {
    const cell = (result: string, liveTestDate: string) => ({
      revision: MCP_BASELINE_STABLE_REVISION,
      clientId: 'client-a',
      result,
      liveTestDate,
    });
    expect(mcpCompatibilityCellUsable(cell(McpConformanceResult.PASS, now), now)).toBe(true);
    expect(mcpCompatibilityCellUsable(cell(McpConformanceResult.FAIL, now), now)).toBe(false);
    const stale = new Date(
      Date.parse(now) - (MCP_LIVE_TEST_MAX_AGE_SECONDS + 60) * 1000,
    ).toISOString();
    expect(mcpCompatibilityCellUsable(cell(McpConformanceResult.PASS, stale), now)).toBe(false);
    expectCode(
      () => mcpCompatibilityCellUsable(cell('MAYBE', now), now),
      ErrorCode.PROD_MCP_CONFORMANCE_RESULT_UNKNOWN,
    );
  });
});

describe('§33.7 bounded precomputed alpha law', () => {
  const bound = {
    artifactSetHash: HASH,
    maxCandidates: 100,
    maxRows: 1000,
    maxEdges: 5000,
    maxLatencyMs: 250,
    maxCostUsd: 0.5,
    expiresAt: '2026-07-01T00:00:00Z',
  };
  const now = '2026-06-01T00:00:00Z';

  it('serves a fresh request within every ceiling', () => {
    expect(
      precomputedAlphaBoundRespected(
        bound,
        { candidates: 100, rows: 1000, edges: 5000, latencyMs: 250, costUsd: 0.5 },
        now,
      ),
    ).toBe(true);
  });

  it('refuses an expired, exceeded, or unbounded request', () => {
    const request = { candidates: 1, rows: 1, edges: 1, latencyMs: 1, costUsd: 0.1 };
    expect(precomputedAlphaBoundRespected(bound, request, '2026-08-01T00:00:00Z')).toBe(false);
    expect(precomputedAlphaBoundRespected(bound, { ...request, candidates: 101 }, now)).toBe(false);
    expectCode(
      () =>
        precomputedAlphaBoundRespected(
          { ...bound, maxLatencyMs: 0 },
          { ...request, latencyMs: 5 },
          now,
        ),
      ErrorCode.PROD_PRECOMPUTED_BOUND_INVALID,
    );
    expectCode(
      () =>
        precomputedAlphaBoundRespected({ ...bound, artifactSetHash: 'not-a-hash' }, request, now),
      ErrorCode.PROD_PRECOMPUTED_BOUND_INVALID,
    );
    expectCode(
      () => assertPrecomputedAlphaRequestWithinBound(bound, { ...request, rows: 99999 }, now),
      ErrorCode.PROD_PRECOMPUTED_BOUND_INVALID,
    );
  });
});

describe('§10.3/§35.14 trust-boundary verdict', () => {
  const complete = [
    {
      assertionKind: ArtifactBoundaryAssertionKind.NO_HEAVY_JOB,
      verdict: ActivationGateVerdict.PASS,
      importArtifactRef: null,
    },
    {
      assertionKind: ArtifactBoundaryAssertionKind.NO_IMPORT,
      verdict: ActivationGateVerdict.PASS,
      importArtifactRef: null,
    },
    {
      assertionKind: ArtifactBoundaryAssertionKind.NO_PROVIDER_CALL,
      verdict: ActivationGateVerdict.PASS,
      importArtifactRef: null,
    },
    {
      assertionKind: ArtifactBoundaryAssertionKind.IMPORT_SHADOW_ONLY,
      verdict: ActivationGateVerdict.PASS,
      importArtifactRef: 'import-1',
    },
  ];

  it('passes the exact closed boundary assertion set', () => {
    expect(trustBoundaryVerdict(complete)).toBe(ActivationGateVerdict.PASS);
    expect(artifactBoundaryHolds(complete)).toBe(true);
    expect(() => assertArtifactBoundaryHolds(complete)).not.toThrow();
  });

  it('refuses a live path reaching a heavy job, import, or provider call', () => {
    const failing = complete.map((assertion) =>
      assertion.assertionKind === ArtifactBoundaryAssertionKind.NO_HEAVY_JOB
        ? { ...assertion, verdict: ActivationGateVerdict.REFUSE }
        : assertion,
    );
    expect(artifactBoundaryHolds(failing)).toBe(false);
    expectCode(() => assertArtifactBoundaryHolds(failing), ErrorCode.PROD_TRUST_BOUNDARY_VIOLATION);
  });

  it('refuses a missing assertion and a mis-bound import reference', () => {
    expect(artifactBoundaryHolds(complete.slice(0, 3))).toBe(false);
    const wrongRef = complete.map((assertion) =>
      assertion.assertionKind === ArtifactBoundaryAssertionKind.NO_IMPORT
        ? { ...assertion, importArtifactRef: 'should-not-be-here' }
        : assertion,
    );
    expect(artifactBoundaryHolds(wrongRef)).toBe(false);
    const missingRef = complete.map((assertion) =>
      assertion.assertionKind === ArtifactBoundaryAssertionKind.IMPORT_SHADOW_ONLY
        ? { ...assertion, importArtifactRef: null }
        : assertion,
    );
    expect(artifactBoundaryHolds(missingRef)).toBe(false);
  });
});
