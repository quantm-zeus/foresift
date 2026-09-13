/**
 * Production-readiness shared-schema suite
 * (T005, FR-PROD-001…006, AC-144, AC-152, AC-153, AC-278, AC-279).
 *
 * Pins the `.strict()` envelopes for the scope-exact module state, the
 * governed transition, the immutable activation-gate evaluation, containment
 * and rollback events, the dependency/Critical-dependency/SLA rows, the
 * best-effort declaration, the MCP revision/client/matrix/conformance rows, the
 * precomputed bound and live read, and the artifact-boundary assertion. Every
 * closed vocabulary is compile-linked to `@foresift/domain`; unknown keys,
 * malformed hashes, draft-as-default, ceiling-less bounds, weakening
 * declarations, and inconsistent boolean/enum pairings are refused.
 */
import { describe, expect, it } from 'bun:test';
import { ALL_PROTECTED_DIMENSIONS } from '@foresift/domain';
import * as prod from '../src/prod.ts';
import {
  ArtifactBoundaryAssertionRowSchema,
  BestEffortDeclarationRowSchema,
  ContainmentEventRowSchema,
  CriticalDependencyRowSchema,
  DependencyGroupRowSchema,
  LivePathAlphaReadRowSchema,
  McpCompatibilityMatrixRowSchema,
  McpConformanceRunRowSchema,
  McpRevisionRowSchema,
  McpTargetClientRowSchema,
  ModuleStateRowSchema,
  PrecomputedAlphaBoundRowSchema,
  ProdSchemaRegistry,
  RollbackEventRowSchema,
  SlaRegisterRowSchema,
  StateTransitionRowSchema,
  ActivationGateEvaluationRowSchema,
  PROD_SCHEMA_REGISTRY_VERSION,
} from '../src/prod.ts';

const HASH = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const AT = '2026-06-01T00:00:00Z';
const LATER = '2026-07-01T00:00:00Z';

const scope = {
  profile_version: 'profile-v1',
  policy_version: 'policy-v1',
  regime_scope: 'regime-v1',
  execution_scenario: 'scenario-v1',
  delay_policy: 'delay-v1',
  population_claim: 'population-v1',
  requires_proven: true,
};

const moduleState = {
  stateRowId: 'state-1',
  moduleId: 'module-1',
  artifactSetHash: HASH,
  scope,
  lifecycleState: 'ACTIVE',
  operationalReadiness: 'READY_FOR_ACTIVE_PROFILE',
  distributionReadiness: 'PRIVATE_ONLY',
  activationEventRef: 'gate-eval-1',
  supersededBy: null,
  createdAt: AT,
};

const gateEvaluation = {
  evaluationId: 'gate-eval-1',
  scopeHash: HASH_B,
  gateKind: 'PROVEN_PRESENT',
  verdict: 'PASS',
  failingGate: null,
  evidenceRefs: ['evidence-1'],
  capacityContractRef: 'capacity-1',
  evaluatedAt: AT,
  expiresAt: LATER,
};

const bestEffort = {
  declarationId: 'declaration-1',
  posture: 'FREE_TIER_BEST_EFFORT',
  degradedScope: { scope: 'public-feed' },
  missingSlaRefs: ['dep-provider-1'],
  weakenedDimensions: ['freshness', 'alert_availability'],
  protectedDimensions: ALL_PROTECTED_DIMENSIONS,
  reason: 'no applicable SLA for the provider dependency',
  declaredAt: AT,
};

const precomputedBound = {
  boundId: 'bound-1',
  livePath: 'live-alpha-read',
  artifactRef: 'artifact-1',
  artifactSetHash: HASH,
  maxCandidates: 100,
  maxRows: 1000,
  maxEdges: 5000,
  maxLatencyMs: 250,
  maxCostUsd: '0.50',
  datasetCutoff: AT,
  verifiedAt: AT,
  expiresAt: LATER,
};

describe('prod schema registry shape', () => {
  it('is versioned and exposes no update schema (immutability by construction)', () => {
    expect(PROD_SCHEMA_REGISTRY_VERSION).toBe(1);
    const names = Object.keys(ProdSchemaRegistry);
    expect(names.length).toBeGreaterThan(30);
    expect(names.some((name) => name.includes('Update'))).toBe(false);
  });

  it('round-trips a registered schema and refuses unknown keys through the parser', () => {
    const parsed = prod.parseProdSchema('ModuleStateRow', moduleState);
    expect(parsed.lifecycleState).toBe('ACTIVE');
    expect(parsed.scope.requires_proven).toBe(true);
    expect(prod.parseProdSchema('ActivationScope', scope)).toEqual(scope);
    expect(() => prod.parseProdSchema('ModuleStateRow', { ...moduleState, extra: 1 })).toThrow();
  });
});

describe('§69.2 module-state row', () => {
  it('accepts the exact §69.5 scope-exact shape', () => {
    const parsed = ModuleStateRowSchema.parse(moduleState);
    expect(parsed.scope.requires_proven).toBe(true);
    expect(parsed.lifecycleState).toBe('ACTIVE');
  });

  it('refuses an unknown key, a malformed hash, and an unknown state', () => {
    expect(() => ModuleStateRowSchema.parse({ ...moduleState, extra: 1 })).toThrow();
    expect(() =>
      ModuleStateRowSchema.parse({ ...moduleState, artifactSetHash: 'sha256:nope' }),
    ).toThrow();
    expect(() =>
      ModuleStateRowSchema.parse({ ...moduleState, lifecycleState: 'DEPLOYED' }),
    ).toThrow();
    expect(() =>
      ModuleStateRowSchema.parse({ ...moduleState, lifecycleState: 'NOT_IMPLEMENTED' }),
    ).toThrow();
  });

  it('refuses an ACTIVE row without an activation event reference', () => {
    expect(() => ModuleStateRowSchema.parse({ ...moduleState, activationEventRef: null })).toThrow(
      /activation event/,
    );
    // A deployed-but-unavailable module is perfectly valid.
    expect(() =>
      ModuleStateRowSchema.parse({
        ...moduleState,
        lifecycleState: 'IMPLEMENTED',
        activationEventRef: null,
      }),
    ).not.toThrow();
  });
});

describe('governed transition and activation-gate evaluation rows', () => {
  it('accepts a seed transition and refuses a self-transition', () => {
    const transition = {
      transitionId: 'transition-1',
      stateRowId: 'state-1',
      fromState: 'NOT_IMPLEMENTED',
      toState: 'IMPLEMENTED',
      changeClassification: 'MATERIAL_OPERATIONAL',
      gateEvaluationRef: null,
      reason: 'initial implementation',
      actorRef: 'actor-1',
      createdAt: AT,
    };
    expect(StateTransitionRowSchema.parse(transition).fromState).toBe('NOT_IMPLEMENTED');
    expect(() =>
      StateTransitionRowSchema.parse({
        ...transition,
        fromState: 'IMPLEMENTED',
        toState: 'IMPLEMENTED',
      }),
    ).toThrow(/must change state/);
    expect(() =>
      StateTransitionRowSchema.parse({ ...transition, changeClassification: 'MATERIAL_VIBES' }),
    ).toThrow();
  });

  it('accepts a PASS with no failing gate and refuses inconsistent verdicts', () => {
    expect(ActivationGateEvaluationRowSchema.parse(gateEvaluation).verdict).toBe('PASS');
    expect(() =>
      ActivationGateEvaluationRowSchema.parse({
        ...gateEvaluation,
        verdict: 'PASS',
        failingGate: 'PROVEN_PRESENT',
      }),
    ).toThrow(/failing gate/);
    expect(() =>
      ActivationGateEvaluationRowSchema.parse({
        ...gateEvaluation,
        verdict: 'REFUSE',
        failingGate: null,
      }),
    ).toThrow(/failing gate/);
    expect(() =>
      ActivationGateEvaluationRowSchema.parse({ ...gateEvaluation, expiresAt: AT }),
    ).toThrow(/expire/);
  });
});

describe('containment and rollback rows', () => {
  const containment = {
    containmentId: 'containment-1',
    moduleId: 'module-1',
    scopeHash: HASH,
    action: 'PAUSED',
    triggerGateKind: 'CAPACITY_CONTRACT',
    reason: 'capacity breach',
    autoReactivationAllowed: false,
    clearedByEventRef: null,
    createdAt: AT,
  };

  it('pins auto-reactivation off and refuses an auto-reactivation row', () => {
    expect(ContainmentEventRowSchema.parse(containment).autoReactivationAllowed).toBe(false);
    expect(() =>
      ContainmentEventRowSchema.parse({ ...containment, autoReactivationAllowed: true }),
    ).toThrow();
  });

  const rollback = {
    rollbackId: 'rollback-1',
    moduleId: 'module-1',
    restoredArtifactSetHash: HASH,
    priorActivationEventRef: 'gate-eval-1',
    newActivationEventRef: 'gate-eval-2',
    historyPreserved: true,
    candidateReevaluationRef: 'reevaluation-1',
    createdAt: AT,
  };

  it('pins history preservation and a NEW activation event', () => {
    expect(RollbackEventRowSchema.parse(rollback).historyPreserved).toBe(true);
    expect(() => RollbackEventRowSchema.parse({ ...rollback, historyPreserved: false })).toThrow();
    expect(() =>
      RollbackEventRowSchema.parse({ ...rollback, newActivationEventRef: 'gate-eval-1' }),
    ).toThrow(/NEW activation event/);
  });
});

describe('§40 dependency groups and §69.6 posture declarations', () => {
  it('accepts a group row and refuses self-dependency or activation', () => {
    const group = {
      groupId: 'G6',
      dependsOn: ['G0', 'G1', 'G2'],
      status: 'IN_PROGRESS',
      manifestRequirementCount: 6,
      evidenceRefs: ['evidence-1'],
      activatesOpportunities: false,
      updatedAt: AT,
    };
    expect(DependencyGroupRowSchema.parse(group).groupId).toBe('G6');
    expect(() => DependencyGroupRowSchema.parse({ ...group, dependsOn: ['G6'] })).toThrow(
      /depend on itself/,
    );
    expect(() =>
      DependencyGroupRowSchema.parse({ ...group, activatesOpportunities: true }),
    ).toThrow();
    expect(() => DependencyGroupRowSchema.parse({ ...group, groupId: 'G9' })).toThrow();
  });

  it('requires an applicable SLA to name its reference', () => {
    const sla = {
      slaId: 'sla-1',
      dependencyId: 'dep-provider-1',
      applicable: true,
      slaRef: 'contract-1',
      verifiedAt: AT,
      expiresAt: LATER,
    };
    expect(SlaRegisterRowSchema.parse(sla).applicable).toBe(true);
    expect(() => SlaRegisterRowSchema.parse({ ...sla, slaRef: null })).toThrow(/SLA reference/);
    expect(() =>
      SlaRegisterRowSchema.parse({
        ...sla,
        applicable: false,
        slaRef: 'contract-1',
      }),
    ).toThrow(/SLA reference/);
    expect(() => SlaRegisterRowSchema.parse({ ...sla, expiresAt: '2026-05-01T00:00:00Z' })).toThrow(
      /expire/,
    );
    expect(
      CriticalDependencyRowSchema.parse({
        dependencyId: 'dep-provider-1',
        kind: 'PROVIDER',
        owner: 'team-data',
        critical: true,
      }).kind,
    ).toBe('PROVIDER');
  });

  it('accepts a compliant best-effort declaration and refuses a protected dimension', () => {
    expect(BestEffortDeclarationRowSchema.parse(bestEffort).weakenedDimensions).toEqual([
      'freshness',
      'alert_availability',
    ]);
    expect(() =>
      BestEffortDeclarationRowSchema.parse({
        ...bestEffort,
        weakenedDimensions: ['audit'],
      }),
    ).toThrow();
    expect(() =>
      BestEffortDeclarationRowSchema.parse({
        ...bestEffort,
        posture: 'SLA_BACKED',
      }),
    ).toThrow(/no weakening/);
    expect(() =>
      BestEffortDeclarationRowSchema.parse({ ...bestEffort, posture: 'BEST_EFFORT' }),
    ).toThrow();
  });
});

describe('§69.7 MCP compatibility rows', () => {
  const revision = {
    revision: '2025-11-25',
    channel: 'STABLE',
    sdkVersion: '1.2.0',
    transport: 'STREAMABLE_HTTP',
    originPolicyRef: 'origin-1',
    isDefault: true,
    supersededBy: null,
    createdAt: AT,
  };

  it('accepts the stable default baseline and refuses a draft default', () => {
    expect(McpRevisionRowSchema.parse(revision).isDefault).toBe(true);
    expect(() => McpRevisionRowSchema.parse({ ...revision, channel: 'DRAFT' })).toThrow(
      /never be the compatibility default/,
    );
  });

  it('round-trips the client, matrix, and conformance rows', () => {
    expect(
      McpTargetClientRowSchema.parse({
        clientId: 'client-a',
        clientName: 'Desktop Client',
        version: '0.9.0',
        capabilities: { tools: true },
        authMode: 'OAUTH_2_1',
      }).clientId,
    ).toBe('client-a');
    expect(
      McpCompatibilityMatrixRowSchema.parse({
        cellId: 'cell-1',
        revision: '2025-11-25',
        clientId: 'client-a',
        conformanceFixtureRef: 'fixture-1',
        liveTestDate: AT,
        result: 'PASS',
        notes: null,
      }).result,
    ).toBe('PASS');
    expect(() =>
      McpCompatibilityMatrixRowSchema.parse({
        cellId: 'cell-1',
        revision: '2025-11-25',
        clientId: 'client-a',
        conformanceFixtureRef: 'fixture-1',
        liveTestDate: AT,
        result: 'MAYBE',
        notes: null,
      }),
    ).toThrow();
    expect(
      McpConformanceRunRowSchema.parse({
        runId: 'run-1',
        revision: '2025-11-25',
        clientId: 'client-a',
        fixtureRef: 'fixture-1',
        result: 'PASS',
        ranAt: AT,
      }).runId,
    ).toBe('run-1');
  });
});

describe('§33.7 precomputed bounds and §10.3/§35.14 boundary assertions', () => {
  it('accepts a bounded record and refuses a ceiling-less or inverted bound', () => {
    expect(PrecomputedAlphaBoundRowSchema.parse(precomputedBound).maxCandidates).toBe(100);
    const ceilingless: Record<string, unknown> = { ...precomputedBound };
    delete ceilingless.maxRows;
    expect(() => PrecomputedAlphaBoundRowSchema.parse(ceilingless)).toThrow();
    expect(() =>
      PrecomputedAlphaBoundRowSchema.parse({ ...precomputedBound, maxEdges: 0 }),
    ).toThrow();
    expect(() =>
      PrecomputedAlphaBoundRowSchema.parse({ ...precomputedBound, expiresAt: AT }),
    ).toThrow(/expire/);
    expect(() =>
      PrecomputedAlphaBoundRowSchema.parse({ ...precomputedBound, maxCostUsd: 0.5 }),
    ).toThrow();
  });

  it('requires a refused read to record its reason and a served read not to', () => {
    const served = {
      readId: 'read-1',
      livePath: 'live-alpha-read',
      boundId: 'bound-1',
      requestHash: HASH_C,
      served: true,
      refusalReason: null,
      latencyMs: 42,
      readAt: AT,
    };
    expect(LivePathAlphaReadRowSchema.parse(served).served).toBe(true);
    expect(() => LivePathAlphaReadRowSchema.parse({ ...served, refusalReason: 'EXPIRED' })).toThrow(
      /reason/,
    );
    expect(() =>
      LivePathAlphaReadRowSchema.parse({ ...served, served: false, refusalReason: null }),
    ).toThrow(/reason/);
  });

  it('binds the import reference to IMPORT_SHADOW_ONLY only', () => {
    const assertion = {
      assertionId: 'assertion-1',
      livePath: 'live-alpha-read',
      assertionKind: 'IMPORT_SHADOW_ONLY',
      importArtifactRef: 'import-1',
      verdict: 'PASS',
      assertedAt: AT,
    };
    expect(ArtifactBoundaryAssertionRowSchema.parse(assertion).importArtifactRef).toBe('import-1');
    expect(() =>
      ArtifactBoundaryAssertionRowSchema.parse({ ...assertion, importArtifactRef: null }),
    ).toThrow(/IMPORT_SHADOW_ONLY/);
    expect(() =>
      ArtifactBoundaryAssertionRowSchema.parse({
        ...assertion,
        assertionKind: 'NO_HEAVY_JOB',
      }),
    ).toThrow(/IMPORT_SHADOW_ONLY/);
  });
});
