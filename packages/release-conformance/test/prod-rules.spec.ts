/**
 * PROD release-conformance rule suite (T032, FR-PROD-001…006, AC-144/152/
 * 272/273/275/276/277/278/279).
 *
 * Every PROD rule must detect its violation and accept compliant input, and the
 * four pre-existing trace rules must keep passing unchanged.
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CLAIM_PROD_RULES,
  CONFORMANCE_RULES,
  GATE_KINDS,
  PROD_RULES,
  checkActivationWithoutEvidence,
  checkProdSurfacePresence,
  checkLivePathPrecomputationViolation,
  checkMcpCompatibilityDrift,
  checkPostureWeakening,
  checkPublicAuthorizationWithoutGateEvidence,
  evaluateConformance,
  evaluateDistributionAuthorization,
  evaluateProdConformance,
  SHADOW_ONLY_IMPORT_ARTIFACT_STATES,
  type ConformanceOptions,
  type ConformanceResult,
  type LivePathPrecomputationClaim,
  type RequirementMapping,
} from '../src/index.ts';
import {
  ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS,
  parseActivationGateKind,
  parseDistributionReadiness,
  type ArtifactBoundaryAssertion,
} from '@foresift/domain';
import {
  PROD_ACTIVATION_CLAIMS,
  PROD_ACTIVE_UNAVAILABLE_CLAIM,
  PROD_ACTIVE_UNPROVEN_CLAIM,
  PROD_ACTIVE_WITHOUT_GATE_CLAIM,
  PROD_BEST_EFFORT_COMPLIANT,
  PROD_BEST_EFFORT_OMITS_PROTECTED,
  PROD_BEST_EFFORT_WEAKENING,
  PROD_COMPLIANT_ACTIVE_CLAIM,
  PROD_DISTRIBUTION_CLAIMS,
  PROD_DISTRIBUTION_REQUIRED_GATES,
  PROD_LIVE_PATH_BOUNDED_CLAIM,
  PROD_LIVE_PATH_CLAIMS,
  PROD_LIVE_PATH_EXCEEDING_CLAIM,
  PROD_LIVE_PATH_IMPORT_CLAIM,
  PROD_LIVE_PATH_NO_BOUND_CLAIM,
  PROD_MCP_COMPLIANT_CLAIM,
  PROD_MCP_DRAFT_DEFAULT_CLAIM,
  PROD_MCP_FAILING_CLAIM,
  PROD_MCP_NO_DEFAULT_CLAIM,
  PROD_MCP_STALE_CLAIM,
  PROD_MCP_UNTESTED_CLAIM,
  PROD_PUBLIC_AUTHORIZED_MISSING_CLAIM,
  PROD_PUBLIC_AUTHORIZED_REVOKED_CLAIM,
  PROD_PUBLIC_AUTHORIZED_WRONG_SCOPE_CLAIM,
  PROD_SLA_BACKED_COMPLIANT,
  PROD_SLA_BACKED_WEAKENING,
  PROD_TECHNICALLY_READY_CLAIM,
  PROD_WORKSPACE_AUTHORIZED_CLAIM,
} from '../../../tests/fixtures/prod/index.ts';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;

describe('PROD rule 1: activation without evidence (AC-152)', () => {
  it('accepts an ACTIVE claim with all dimensions, a PASS gate, and an activation event', () => {
    const report = checkActivationWithoutEvidence([PROD_COMPLIANT_ACTIVE_CLAIM]);
    expect(report.passed).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('flags an ACTIVE module without a passing gate', () => {
    const report = checkActivationWithoutEvidence([PROD_ACTIVE_WITHOUT_GATE_CLAIM]);
    expect(report.passed).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(finding.rule).toBe(PROD_RULES.activationWithoutEvidence);
      expect(finding.path).toBe(PROD_ACTIVE_WITHOUT_GATE_CLAIM.moduleId);
    }
  });

  it('flags ACTIVE from IMPLEMENTED alone and ACTIVE without required PROVEN', () => {
    const unavailable = checkActivationWithoutEvidence([PROD_ACTIVE_UNAVAILABLE_CLAIM]);
    expect(unavailable.passed).toBe(false);
    expect(unavailable.findings.some((f) => f.message.includes('AVAILABLE'))).toBe(true);

    const unproven = checkActivationWithoutEvidence([PROD_ACTIVE_UNPROVEN_CLAIM]);
    expect(unproven.passed).toBe(false);
    expect(unproven.findings.some((f) => f.message.includes('PROVEN'))).toBe(true);
  });

  it('ignores a shadow-only module that makes no ACTIVE claim', () => {
    const shadowOnly = PROD_ACTIVATION_CLAIMS.filter((claim) => claim.lifecycleState !== 'ACTIVE');
    const report = checkActivationWithoutEvidence(shadowOnly);
    expect(report.passed).toBe(true);
  });
});

describe('PROD rule 2: posture weakening (AC-153)', () => {
  it('accepts a free-tier declaration that relaxes only relaxable dimensions', () => {
    expect(checkPostureWeakening([PROD_BEST_EFFORT_COMPLIANT]).passed).toBe(true);
    expect(checkPostureWeakening([PROD_SLA_BACKED_COMPLIANT]).passed).toBe(true);
  });

  it('flags a declaration that weakens the protected audit dimension', () => {
    const report = checkPostureWeakening([PROD_BEST_EFFORT_WEAKENING]);
    expect(report.passed).toBe(false);
    expect(report.findings[0]?.rule).toBe(PROD_RULES.postureWeakening);
    expect(report.findings[0]?.path).toBe(PROD_BEST_EFFORT_WEAKENING.declarationId);
  });

  it('flags an SLA_BACKED posture that weakens anything', () => {
    const report = checkPostureWeakening([PROD_SLA_BACKED_WEAKENING]);
    expect(report.passed).toBe(false);
  });

  it('flags a declaration that omits a protected dimension', () => {
    const report = checkPostureWeakening([PROD_BEST_EFFORT_OMITS_PROTECTED]);
    expect(report.passed).toBe(false);
    expect(report.findings.some((f) => f.message.includes('security'))).toBe(true);
  });
});

describe('PROD rule 3: MCP compatibility drift (AC-144)', () => {
  it('accepts a stable default tested green for every supported client', () => {
    expect(checkMcpCompatibilityDrift(PROD_MCP_COMPLIANT_CLAIM).passed).toBe(true);
  });

  it('flags a draft revision as the compatibility default', () => {
    const report = checkMcpCompatibilityDrift(PROD_MCP_DRAFT_DEFAULT_CLAIM);
    expect(report.passed).toBe(false);
    expect(report.findings.some((f) => f.message.includes('only STABLE may default'))).toBe(true);
  });

  it('flags a missing default revision', () => {
    const report = checkMcpCompatibilityDrift(PROD_MCP_NO_DEFAULT_CLAIM);
    expect(report.passed).toBe(false);
    expect(report.findings.some((f) => f.message.includes('no MCP revision'))).toBe(true);
  });

  it('flags an untested, stale, or failing default-revision cell', () => {
    expect(checkMcpCompatibilityDrift(PROD_MCP_UNTESTED_CLAIM).passed).toBe(false);
    expect(checkMcpCompatibilityDrift(PROD_MCP_STALE_CLAIM).passed).toBe(false);
    expect(checkMcpCompatibilityDrift(PROD_MCP_FAILING_CLAIM).passed).toBe(false);
  });
});

describe('PROD rule 4: live-path precomputation violation (AC-279)', () => {
  it('accepts a bounded, unexpired lookup within every ceiling with a holding boundary', () => {
    expect(checkLivePathPrecomputationViolation([PROD_LIVE_PATH_BOUNDED_CLAIM]).passed).toBe(true);
  });

  it('flags a live path with no bounded envelope and one exceeding a ceiling', () => {
    expect(checkLivePathPrecomputationViolation([PROD_LIVE_PATH_NO_BOUND_CLAIM]).passed).toBe(
      false,
    );
    expect(checkLivePathPrecomputationViolation([PROD_LIVE_PATH_EXCEEDING_CLAIM]).passed).toBe(
      false,
    );
  });

  it('flags a live path reaching a heavy job/import that cannot assert NO_IMPORT', () => {
    const report = checkLivePathPrecomputationViolation([PROD_LIVE_PATH_IMPORT_CLAIM]);
    expect(report.passed).toBe(false);
    expect(report.findings[0]?.rule).toBe(PROD_RULES.livePathPrecomputationViolation);
    expect(report.findings[0]?.path).toBe(PROD_LIVE_PATH_IMPORT_CLAIM.livePath);
  });

  it('evaluates the whole fixture corpus without throwing', () => {
    const report = checkLivePathPrecomputationViolation(PROD_LIVE_PATH_CLAIMS);
    expect(report.passed).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it('reports a non-JSON-serializable (BigInt) import state instead of throwing (LOW)', () => {
    // `importArtifactState` is untrusted in-process input: a BigInt on the
    // assertion must yield a finding, never a `JSON.stringify` TypeError that
    // crashes the rule (and, with it, the whole conformance evaluation).
    const boundaryAssertions: readonly ArtifactBoundaryAssertion[] = [
      { assertionKind: 'NO_HEAVY_JOB', verdict: 'PASS', importArtifactRef: null },
      { assertionKind: 'NO_IMPORT', verdict: 'PASS', importArtifactRef: null },
      { assertionKind: 'NO_PROVIDER_CALL', verdict: 'PASS', importArtifactRef: null },
      {
        assertionKind: 'IMPORT_SHADOW_ONLY',
        verdict: 'PASS',
        importArtifactRef: 'import-artifact-bigint',
        importArtifactState: 123n as unknown as string,
      },
    ];
    const claim: LivePathPrecomputationClaim = {
      ...PROD_LIVE_PATH_BOUNDED_CLAIM,
      boundaryAssertions,
    };
    let report: ReturnType<typeof checkLivePathPrecomputationViolation> | undefined;
    expect(() => {
      report = checkLivePathPrecomputationViolation([claim]);
    }).not.toThrow();
    expect(report?.passed).toBe(false);
    const finding = report?.findings.find((candidate) =>
      candidate.message.includes('IMPORT_SHADOW_ONLY must reference an import artifact'),
    );
    expect(finding).toBeDefined();
    expect(finding?.rule).toBe(PROD_RULES.livePathPrecomputationViolation);
    // The decision is unchanged (a non-shadow state refuses) and the message is
    // total; the BigInt is rendered rather than throwing.
    expect(finding?.message).toContain('got 123');
  });
});

describe('PROD rule 5: public authorization without gate evidence (AC-272/273/275/276/277)', () => {
  it('accepts an authorized surface carrying the full exact-release evidence set', () => {
    expect(
      checkPublicAuthorizationWithoutGateEvidence([PROD_WORKSPACE_AUTHORIZED_CLAIM]).passed,
    ).toBe(true);
    expect(evaluateDistributionAuthorization(PROD_WORKSPACE_AUTHORIZED_CLAIM).authorized).toBe(
      true,
    );
  });

  it('flags missing, foreign-scoped, and revoked gate evidence', () => {
    for (const claim of [
      PROD_PUBLIC_AUTHORIZED_MISSING_CLAIM,
      PROD_PUBLIC_AUTHORIZED_WRONG_SCOPE_CLAIM,
      PROD_PUBLIC_AUTHORIZED_REVOKED_CLAIM,
    ]) {
      const report = checkPublicAuthorizationWithoutGateEvidence([claim]);
      expect(report.passed, claim.distributionReadiness).toBe(false);
      expect(report.findings[0]?.rule).toBe(PROD_RULES.publicAuthorizationWithoutGateEvidence);
    }
  });

  it('keeps a technically-ready surface unauthorized without inventing a finding', () => {
    const evaluation = evaluateDistributionAuthorization(PROD_TECHNICALLY_READY_CLAIM);
    expect(evaluation.readinessAuthorized).toBe(false);
    expect(evaluation.authorized).toBe(false);
    expect(checkPublicAuthorizationWithoutGateEvidence([PROD_TECHNICALLY_READY_CLAIM]).passed).toBe(
      true,
    );
  });

  it('aggregates every distribution fixture into a failing report', () => {
    const report = checkPublicAuthorizationWithoutGateEvidence(PROD_DISTRIBUTION_CLAIMS);
    expect(report.passed).toBe(false);
    // The one compliant claim and the honest technically-ready claim are clean.
    expect(report.findings.length).toBe(3);
  });
});

describe('PROD conformance aggregation and unchanged trace rules', () => {
  it('aggregates all five rules into a FAILED report when any finding exists', () => {
    const report = evaluateProdConformance({
      activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
      postureDeclarations: [PROD_BEST_EFFORT_WEAKENING],
      mcpCompatibility: PROD_MCP_DRAFT_DEFAULT_CLAIM,
      livePaths: [PROD_LIVE_PATH_NO_BOUND_CLAIM],
      distributionAuthorizations: [PROD_PUBLIC_AUTHORIZED_MISSING_CLAIM],
    });
    expect(report.overall).toBe('FAILED');
    const rules = new Set(report.findings.map((finding) => finding.rule));
    for (const key of CLAIM_PROD_RULES) {
      const rule = PROD_RULES[key];
      expect(rules, `${rule} must fire`).toContain(rule);
    }
  });

  it('accepts the compliant corpus with a PASSED report', () => {
    const report = evaluateProdConformance({
      activationClaims: [PROD_COMPLIANT_ACTIVE_CLAIM],
      postureDeclarations: [PROD_BEST_EFFORT_COMPLIANT],
      mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
      livePaths: [PROD_LIVE_PATH_BOUNDED_CLAIM],
      distributionAuthorizations: [PROD_WORKSPACE_AUTHORIZED_CLAIM, PROD_TECHNICALLY_READY_CLAIM],
    });
    expect(report.overall).toBe('PASSED');
    expect(report.findings).toEqual([]);
  });

  it('flags a live path whose request names a different artifact set than its bound (H10)', () => {
    const report = checkLivePathPrecomputationViolation([
      {
        ...PROD_LIVE_PATH_BOUNDED_CLAIM,
        request: {
          ...PROD_LIVE_PATH_BOUNDED_CLAIM.request,
          artifactSetHash: `sha256:${'9'.repeat(64)}`,
        },
      },
    ]);
    expect(report.passed).toBe(false);
    expect(report.findings[0]?.rule).toBe(PROD_RULES.livePathPrecomputationViolation);
  });

  it('cannot widen the MCP freshness window with a caller override (H10 residual)', () => {
    const staleCell = {
      revision: '2025-11-25',
      clientId: 'client-a',
      result: 'PASS',
      liveTestDate: '2000-01-01T00:00:00Z',
    };
    const claim = {
      revisions: [
        { revision: '2025-11-25', channel: 'STABLE', isDefault: true, supersededBy: null },
      ],
      clients: [{ clientId: 'client-a' }],
      cells: [staleCell],
      now: '2026-06-01T00:00:00Z',
      maxAgeSeconds: 1e12,
    };
    const report = checkMcpCompatibilityDrift(claim as never);
    expect(report.passed).toBe(false);
    expect(report.findings[0]?.rule).toBe(PROD_RULES.mcpCompatibilityDrift);
  });

  it('treats malformed mandatory inputs as omissions (H2 residual)', () => {
    const malformed = evaluateProdConformance({
      activationClaims: 'not-an-array',
      postureDeclarations: '',
      mcpCompatibility: 'also-wrong',
      livePaths: '',
      distributionAuthorizations: '',
    } as never);
    expect(malformed.overall).toBe('FAILED');
    expect(
      malformed.findings.filter(
        (finding) => finding.rule === PROD_RULES.prodConformanceInputMissing,
      ),
    ).toHaveLength(5);
  });

  it('treats null mandatory inputs as omissions (H2 residual)', () => {
    const report = evaluateProdConformance({
      activationClaims: null,
      postureDeclarations: null,
      mcpCompatibility: null,
      livePaths: null,
      distributionAuthorizations: null,
    } as never);
    expect(report.overall).toBe('FAILED');
    expect(
      report.findings.filter((finding) => finding.rule === PROD_RULES.prodConformanceInputMissing),
    ).toHaveLength(5);
  });

  it('keeps the four pre-existing trace rules present and unchanged', () => {
    expect(CONFORMANCE_RULES).toEqual({
      mapping: 'NORMATIVE_MAPPING_COMPLETE',
      activePath: 'ACTIVE_IMPLEMENTATION_PATH_EXISTS',
      premature: 'DEPENDENCY_GATE_NOT_OPEN',
      generated: 'GENERATED_DOCUMENT_DRIFT',
    });
  });

  it('fails closed when the PROD governance claims are omitted (H1/H2)', async () => {
    const { evaluateConformance } = await import('../src/index.ts');
    const result = await evaluateConformance({ repoRoot: REPO_ROOT });
    expect(result.overall).toBe('FAILED');
    expect(result.findings.map((finding) => finding.rule)).toContain(
      'PROD_CONFORMANCE_INPUT_MISSING',
    );
  });

  it('invokes the PROD rules from the release gate and FAILS a violating tree (H1)', async () => {
    const { evaluateConformance } = await import('../src/index.ts');
    const result = await evaluateConformance({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      prodClaims: {
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [PROD_BEST_EFFORT_WEAKENING],
        mcpCompatibility: PROD_MCP_DRAFT_DEFAULT_CLAIM,
        livePaths: [PROD_LIVE_PATH_NO_BOUND_CLAIM],
        distributionAuthorizations: [PROD_PUBLIC_AUTHORIZED_MISSING_CLAIM],
      },
    });
    expect(result.overall).toBe('FAILED');
    const rules = new Set(result.findings.map((finding) => finding.rule));
    expect(rules).toContain(PROD_RULES.activationWithoutEvidence);
    expect(rules).toContain(PROD_RULES.postureWeakening);
    expect(rules).toContain(PROD_RULES.mcpCompatibilityDrift);
    expect(rules).toContain(PROD_RULES.livePathPrecomputationViolation);
    expect(rules).toContain(PROD_RULES.publicAuthorizationWithoutGateEvidence);
  });

  it('emits no PROD finding for the compliant claim set on the live tree', async () => {
    const { evaluateConformance } = await import('../src/index.ts');
    const result = await evaluateConformance({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      prodClaims: {
        activationClaims: [PROD_COMPLIANT_ACTIVE_CLAIM],
        postureDeclarations: [PROD_BEST_EFFORT_COMPLIANT],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [PROD_LIVE_PATH_BOUNDED_CLAIM],
        distributionAuthorizations: [PROD_WORKSPACE_AUTHORIZED_CLAIM, PROD_TECHNICALLY_READY_CLAIM],
      },
    });
    expect(result.findings.map((finding) => finding.rule)).not.toContain(
      PROD_RULES.prodSurfaceMissing,
    );
    expect(result.findings.map((finding) => finding.rule)).not.toContain(
      PROD_RULES.prodConformanceInputMissing,
    );
  });

  it('refuses an invalid or non-canonical milestone instead of disabling the PROD rules (HIGH-3)', async () => {
    const { evaluateConformance } = await import('../src/index.ts');
    for (const milestone of ['xyz', '', 'G', 'g2', 'G2x', 'G02', 'G002', 'G8']) {
      const result = await evaluateConformance({
        repoRoot: REPO_ROOT,
        milestone,
        prodClaims: {
          activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
          postureDeclarations: [],
          mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
          livePaths: [],
          distributionAuthorizations: [],
        },
      });
      expect(result.overall, `milestone ${JSON.stringify(milestone)}`).toBe('FAILED');
      expect(result.findings.map((finding) => finding.rule)).toContain(
        'CONFORMANCE_MILESTONE_INVALID',
      );
    }
  });

  it('cannot be silenced by an injected empty requirement list (HIGH-3 residual)', async () => {
    const { evaluateConformance } = await import('../src/index.ts');
    const result = await evaluateConformance({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      // A caller-supplied requirement list must NOT decide whether PROD law
      // applies: the authoritative manifest does.
      requirements: [],
      prodClaims: {
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      },
    });
    expect(result.findings.map((finding) => finding.rule)).toContain(
      PROD_RULES.activationWithoutEvidence,
    );
  });

  it('runs the PROD rules whenever the milestone owns FR-PROD requirements', async () => {
    const { evaluateConformance } = await import('../src/index.ts');
    const result = await evaluateConformance({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      prodClaims: {
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      },
    });
    expect(result.findings.map((finding) => finding.rule)).toContain(
      PROD_RULES.activationWithoutEvidence,
    );
  });

  it('fails closed through the GOVERNED rule on an empty gate set and unknown readiness (H2)', () => {
    const emptyGates = evaluateProdConformance({
      activationClaims: [],
      postureDeclarations: [],
      mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
      livePaths: [],
      distributionAuthorizations: [{ ...PROD_WORKSPACE_AUTHORIZED_CLAIM, requiredGateKinds: [] }],
    });
    expect(emptyGates.overall).toBe('FAILED');
    expect(emptyGates.findings.map((finding) => finding.rule)).toContain(
      PROD_RULES.publicAuthorizationWithoutGateEvidence,
    );
    expect(emptyGates.findings[0]?.message).toMatch(/no required gate kinds/);

    const unknownReadiness = evaluateProdConformance({
      activationClaims: [],
      postureDeclarations: [],
      mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
      livePaths: [],
      distributionAuthorizations: [
        { ...PROD_WORKSPACE_AUTHORIZED_CLAIM, distributionReadiness: 'TOTALLY_MADE_UP' },
      ],
    });
    expect(unknownReadiness.overall).toBe('FAILED');
    expect(unknownReadiness.findings[0]?.message).toMatch(/unknown distribution readiness/);
  });

  it('flags a dropped PROD surface ref in the live tree (H1 negative)', async () => {
    const report = await checkProdSurfacePresence({
      repoRoot: REPO_ROOT,
      requirements: [
        {
          id: 'FR-PROD-999',
          supersededBy: [],
          implementationRefs: ['packages/capability-registry/does-not-exist/**'],
          schemaRefs: [],
          persistenceRefs: [],
          telemetryRefs: [],
          fixtureRefs: [],
          apiToolUiRefs: [],
          testRefs: [],
        },
      ],
    });
    expect(report.passed).toBe(false);
    expect(report.findings[0]?.rule).toBe(PROD_RULES.prodSurfaceMissing);
    expect(report.findings[0]?.message).toMatch(/does not resolve in the live repository/);
  });

  it('reports malformed claim ELEMENTS instead of silently skipping them (H2 residual)', () => {
    const report = evaluateProdConformance({
      activationClaims: [{}, 'not-a-claim'],
      postureDeclarations: [],
      mcpCompatibility: { revisions: null, clients: [], cells: [], now: '2026-06-01T00:00:00Z' },
      livePaths: [],
      distributionAuthorizations: [],
    } as never);
    expect(report.overall).toBe('FAILED');
    const paths = report.findings
      .filter((finding) => finding.rule === PROD_RULES.prodConformanceInputMissing)
      .map((finding) => finding.path);
    expect(paths).toContain('activationClaims[0].moduleId');
    expect(paths).toContain('activationClaims[1]');
    expect(paths).toContain('mcpCompatibility.revisions');
  });

  it('fails closed on an omitted input, an empty required-gate set, and unknown readiness (H2)', () => {
    expect(evaluateProdConformance({}).overall).toBe('FAILED');
    expect(evaluateProdConformance({}).findings.map((finding) => finding.rule)).toContain(
      PROD_RULES.prodConformanceInputMissing,
    );

    const emptyGates = evaluateDistributionAuthorization({
      ...PROD_WORKSPACE_AUTHORIZED_CLAIM,
      requiredGateKinds: [],
    });
    expect(emptyGates.authorized).toBe(false);
    expect(emptyGates.requiredGateKindsEmpty).toBe(true);

    const unknown = evaluateDistributionAuthorization({
      ...PROD_WORKSPACE_AUTHORIZED_CLAIM,
      distributionReadiness: 'TOTALLY_MADE_UP',
    });
    expect(unknown.readinessKnown).toBe(false);
    expect(unknown.authorized).toBe(false);
  });
});

describe('THIRD-ROUND exploit regressions (R2/R3, T055/T056/T057)', () => {
  const activeBase = {
    moduleId: 'module-r2',
    lifecycleState: 'ACTIVE',
    implemented: true,
    available: true,
    proven: true,
    requiresProven: true,
    gateVerdict: 'PASS',
  } as const;

  it('fails closed when an ACTIVE claim omits or empties its activation event (R2)', () => {
    const omitted = checkActivationWithoutEvidence([activeBase as never]);
    expect(omitted.passed).toBe(false);
    expect(
      omitted.findings.some((finding) => finding.message.includes('non-empty activation event')),
    ).toBe(true);

    for (const eventRef of ['', '   ']) {
      const report = checkActivationWithoutEvidence([
        { ...activeBase, activationEventRef: eventRef } as never,
      ]);
      expect(report.passed).toBe(false);
      expect(
        report.findings.some((finding) => finding.message.includes('non-empty activation event')),
      ).toBe(true);
    }

    // A non-boolean PROVEN requirement is not `false`, and an unparseable
    // governed position is not a non-ACTIVE position: both fail closed.
    expect(
      checkActivationWithoutEvidence([
        { ...activeBase, activationEventRef: 'event-ok', requiresProven: 'true' } as never,
      ]).passed,
    ).toBe(false);
    expect(
      checkActivationWithoutEvidence([
        {
          ...activeBase,
          activationEventRef: 'event-ok',
          lifecycleState: 'TOTALLY_MADE_UP',
        } as never,
      ]).passed,
    ).toBe(false);

    // The compliant claim still passes.
    expect(
      checkActivationWithoutEvidence([
        { ...activeBase, activationEventRef: 'activation-ok' } as never,
      ]).passed,
    ).toBe(true);
  });

  it('never substring-matches a foreign release from a string scopeRefs (R3)', () => {
    // Every case below declares the FULL authoritative gate set, so the only
    // reason it can refuse is the scoping defect under test — a truncated
    // declaration would refuse for the wrong reason (audit R4).
    const authoritativeGates = [...PROD_DISTRIBUTION_REQUIRED_GATES];
    // One record (RIGHTS) carries a STRING scopeRefs; the rest are exact-release
    // arrays. `String.prototype.includes` would substring-match 'rel'.
    const stringScopedEvidence = authoritativeGates.map((gateKind) => ({
      evidenceId: `e-${gateKind}`,
      gateKind,
      scopeRefs: gateKind === 'RIGHTS' ? 'foreign-release-rel' : ['rel'],
      valid: true,
    }));
    const foreign = evaluateDistributionAuthorization({
      releaseRef: 'rel',
      distributionReadiness: 'WORKSPACE_AUTHORIZED',
      requiredGateKinds: authoritativeGates,
      gateEvidence: stringScopedEvidence,
    } as never);
    expect(foreign.authorized).toBe(false);
    expect(foreign.malformedGateEvidence).toBe(true);

    const report = checkPublicAuthorizationWithoutGateEvidence([
      {
        releaseRef: 'rel',
        distributionReadiness: 'WORKSPACE_AUTHORIZED',
        requiredGateKinds: authoritativeGates,
        gateEvidence: stringScopedEvidence,
      } as never,
    ]);
    expect(report.passed).toBe(false);
    expect(report.findings.some((finding) => finding.message.includes('scopeRefs'))).toBe(true);

    // A genuine array scope still authorizes, and the aggregate still fails.
    const genuine = evaluateDistributionAuthorization({
      releaseRef: 'rel',
      distributionReadiness: 'WORKSPACE_AUTHORIZED',
      requiredGateKinds: authoritativeGates,
      gateEvidence: authoritativeGates.map((gateKind) => ({
        evidenceId: `e-${gateKind}`,
        gateKind,
        scopeRefs: ['rel'],
        valid: true,
      })),
    } as never);
    expect(genuine.authorized).toBe(true);

    const aggregate = evaluateProdConformance({
      activationClaims: [],
      postureDeclarations: [],
      mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
      livePaths: [],
      distributionAuthorizations: [
        {
          releaseRef: 'rel',
          distributionReadiness: 'WORKSPACE_AUTHORIZED',
          requiredGateKinds: authoritativeGates,
          gateEvidence: stringScopedEvidence,
        },
      ],
    } as never);
    expect(aggregate.overall).toBe('FAILED');
    expect(aggregate.findings.map((finding) => finding.rule)).toContain(
      PROD_RULES.publicAuthorizationWithoutGateEvidence,
    );
  });

  it('fails a malformed repository milestone closed with a finding (T057)', async () => {
    const { evaluateConformance } = await import('../src/index.ts');
    const dir = await mkdtemp(path.join(tmpdir(), 'foresift-milestone-'));
    try {
      await mkdir(path.join(dir, 'specs/implementation'), { recursive: true });
      await writeFile(
        path.join(dir, 'specs/implementation/current-milestone.json'),
        JSON.stringify({ milestoneId: 'G8', status: 'ACTIVE', packages: [] }),
      );
      const result = await evaluateConformance({ repoRoot: dir });
      expect(result.overall).toBe('FAILED');
      expect(result.findings.map((finding) => finding.rule)).toContain(
        'CONFORMANCE_MILESTONE_INVALID',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a boxed/coercible milestone that would skip the PROD block', async () => {
    const { evaluateConformance } = await import('../src/index.ts');
    const result = await evaluateConformance({
      repoRoot: REPO_ROOT,
      milestone: new String('G2') as unknown as string,
    });
    expect(result.overall).toBe('FAILED');
    expect(result.findings.map((finding) => finding.rule)).toContain(
      'CONFORMANCE_MILESTONE_INVALID',
    );
  });

  it('resists in-process array-method shadowing and degenerate release ids', () => {
    const authoritativeGates = [...PROD_DISTRIBUTION_REQUIRED_GATES];
    // Own `filter` returning forged in-scope evidence must not authorize. The
    // REAL evidence is foreign-scoped for every authoritative kind, so a
    // `filter`-based implementation would be fooled by the shadowed method.
    const shadowedFilter = authoritativeGates.map((gateKind) => ({
      evidenceId: `e-${gateKind}`,
      gateKind,
      scopeRefs: ['foreign-release'],
      valid: true,
    }));
    Object.defineProperty(shadowedFilter, 'filter', {
      value: () =>
        authoritativeGates.map((gateKind) => ({
          evidenceId: `forged-${gateKind}`,
          gateKind,
          scopeRefs: ['rel'],
          valid: true,
        })),
    });
    expect(
      evaluateDistributionAuthorization({
        releaseRef: 'rel',
        distributionReadiness: 'WORKSPACE_AUTHORIZED',
        requiredGateKinds: authoritativeGates,
        gateEvidence: shadowedFilter,
      } as never).authorized,
    ).toBe(false);

    // Own `includes` returning true must not pull a foreign scope into scope.
    const shadowedIncludes = ['foreign-release'];
    Object.defineProperty(shadowedIncludes, 'includes', { value: () => true });
    expect(
      evaluateDistributionAuthorization({
        releaseRef: 'rel',
        distributionReadiness: 'WORKSPACE_AUTHORIZED',
        requiredGateKinds: authoritativeGates,
        gateEvidence: authoritativeGates.map((gateKind) => ({
          evidenceId: `e-${gateKind}`,
          gateKind,
          scopeRefs: shadowedIncludes,
          valid: true,
        })),
      } as never).authorized,
    ).toBe(false);

    // A degenerate release identity never authorizes, even when the evidence
    // scope exactly matches it.
    const degenerate = evaluateDistributionAuthorization({
      releaseRef: '',
      distributionReadiness: 'WORKSPACE_AUTHORIZED',
      requiredGateKinds: authoritativeGates,
      gateEvidence: authoritativeGates.map((gateKind) => ({
        evidenceId: `e-${gateKind}`,
        gateKind,
        scopeRefs: [''],
        valid: true,
      })),
    } as never);
    expect(degenerate.authorized).toBe(false);
    expect(degenerate.malformedReleaseRef).toBe(true);
  });
});

describe('FOURTH-ROUND exploit regressions (R4/R7, audit H2/H4)', () => {
  const AUTHORITATIVE_GATES = [...PROD_DISTRIBUTION_REQUIRED_GATES];
  const VALID_EXACT_RELEASE_EVIDENCE = AUTHORITATIVE_GATES.map((gateKind) => ({
    evidenceId: `evidence-${gateKind.toLowerCase()}`,
    gateKind,
    scopeRefs: ['rel'],
    valid: true,
  }));

  /** A compliant baseline claim whose only variable is the gate declaration. */
  function publicAuthorizationClaim(overrides: Record<string, unknown>): unknown {
    return {
      releaseRef: 'rel',
      distributionReadiness: 'PUBLIC_AUTHORIZED',
      requiredGateKinds: AUTHORITATIVE_GATES,
      gateEvidence: VALID_EXACT_RELEASE_EVIDENCE,
      ...overrides,
    };
  }

  /** The otherwise-compliant claim set for one public-authorization claim. */
  function conformanceWithAuthorization(claim: unknown) {
    return evaluateProdConformance({
      activationClaims: [],
      postureDeclarations: [],
      mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
      livePaths: [],
      distributionAuthorizations: [claim],
    } as never);
  }

  it('binds the mandatory set to the exported authoritative GATE_KINDS vocabulary (R4)', () => {
    // The fixture list is an INDEPENDENT literal (audit NEW-L6), so this is a
    // genuine cross-check: either side drifting from the five authoritative
    // kinds fails here rather than agreeing with itself.
    expect([...PROD_DISTRIBUTION_REQUIRED_GATES].sort()).toEqual([...GATE_KINDS].sort());
    expect([...SHADOW_ONLY_IMPORT_ARTIFACT_STATES]).toEqual(['VALIDATING', 'SHADOW_ELIGIBLE']);
  });

  it('freezes the authoritative gate and import-state sets against in-process mutation (NEW-H1)', () => {
    // The R4/R7 guards read these module exports as their authority, so a
    // mutable export re-opens the fabricated/truncated self-attestation and
    // REJECTED-import exploits the fourth round closed. `as const` is
    // compile-time only; the runtime freeze is what this test pins.
    expect(Object.isFrozen(GATE_KINDS)).toBe(true);
    expect(Object.isFrozen(SHADOW_ONLY_IMPORT_ARTIFACT_STATES)).toBe(true);

    // ESM test modules are strict mode, so each mutation attempt throws. A
    // silent non-strict no-op would be equally refused; the contents below are
    // asserted unchanged either way.
    expect(() => (GATE_KINDS as unknown as string[]).push('TOTALLY_FAKE_GATE')).toThrow();
    expect(() => {
      (GATE_KINDS as unknown as string[]).length = 0;
    }).toThrow();
    expect(() =>
      (SHADOW_ONLY_IMPORT_ARTIFACT_STATES as unknown as string[]).push('REJECTED'),
    ).toThrow();
    expect([...GATE_KINDS]).toEqual(['MANUAL', 'LEGAL', 'RIGHTS', 'STATISTICAL', 'OWNER_APPROVAL']);
    expect([...SHADOW_ONLY_IMPORT_ARTIFACT_STATES]).toEqual(['VALIDATING', 'SHADOW_ELIGIBLE']);

    // The fabricated TOTALLY_FAKE_GATE claim is still refused after the
    // attempted mutations: an in-process caller cannot rewrite the authority.
    const fabricated = publicAuthorizationClaim({
      requiredGateKinds: ['TOTALLY_FAKE_GATE'],
      gateEvidence: [
        { evidenceId: 'e', gateKind: 'TOTALLY_FAKE_GATE', scopeRefs: ['rel'], valid: true },
      ],
    });
    const evaluation = evaluateDistributionAuthorization(fabricated as never);
    expect(evaluation.authorized).toBe(false);
    expect(evaluation.unknownGateKinds).toEqual(['TOTALLY_FAKE_GATE']);
    expect(conformanceWithAuthorization(fabricated).overall).toBe('FAILED');

    // A REJECTED import state still yields a live-path finding after the
    // attempted push into the shadow-only set.
    const rejected = conformanceWithLivePath(livePathWithImportState('REJECTED'));
    expect(rejected.overall).toBe('FAILED');
    expect(rejected.findings.map((finding) => finding.rule)).toContain(
      PROD_RULES.livePathPrecomputationViolation,
    );
  });

  it('refuses the fabricated TOTALLY_FAKE_GATE self-attestation exploit (R4)', () => {
    const fabricated = publicAuthorizationClaim({
      requiredGateKinds: ['TOTALLY_FAKE_GATE'],
      gateEvidence: [
        { evidenceId: 'e', gateKind: 'TOTALLY_FAKE_GATE', scopeRefs: ['rel'], valid: true },
      ],
    });
    const evaluation = evaluateDistributionAuthorization(fabricated as never);
    expect(evaluation.authorized).toBe(false);
    expect(evaluation.unknownGateKinds).toEqual(['TOTALLY_FAKE_GATE']);
    expect(evaluation.omittedMandatoryGateKinds).toEqual(AUTHORITATIVE_GATES);
    expect(evaluation.missingGateKinds).toEqual(AUTHORITATIVE_GATES);

    const aggregate = conformanceWithAuthorization(fabricated);
    expect(aggregate.overall).toBe('FAILED');
    expect(aggregate.findings.map((finding) => finding.rule)).toContain(
      PROD_RULES.publicAuthorizationWithoutGateEvidence,
    );
    expect(aggregate.findings[0]?.message).toContain(
      'declared gate kinds outside the authoritative set: TOTALLY_FAKE_GATE',
    );
    expect(aggregate.findings[0]?.message).toContain(
      'authoritative mandatory gate kinds omitted from the declaration',
    );
  });

  it('refuses the DISTRIBUTION_EVIDENCE truncation exploit (R4)', () => {
    const truncated = publicAuthorizationClaim({
      requiredGateKinds: ['DISTRIBUTION_EVIDENCE'],
      gateEvidence: [
        { evidenceId: 'e', gateKind: 'DISTRIBUTION_EVIDENCE', scopeRefs: ['rel'], valid: true },
      ],
    });
    const evaluation = evaluateDistributionAuthorization(truncated as never);
    expect(evaluation.authorized).toBe(false);
    expect(evaluation.unknownGateKinds).toEqual(['DISTRIBUTION_EVIDENCE']);
    expect(evaluation.omittedMandatoryGateKinds).toEqual(AUTHORITATIVE_GATES);
    expect(evaluation.missingGateKinds).toEqual(AUTHORITATIVE_GATES);

    const aggregate = conformanceWithAuthorization(truncated);
    expect(aggregate.overall).toBe('FAILED');
    expect(aggregate.findings.map((finding) => finding.rule)).toContain(
      PROD_RULES.publicAuthorizationWithoutGateEvidence,
    );
  });

  it('still refuses a declaration that omits one authoritative kind (R4)', () => {
    const withoutRights = AUTHORITATIVE_GATES.filter((gateKind) => gateKind !== 'RIGHTS');
    const evaluation = evaluateDistributionAuthorization(
      publicAuthorizationClaim({
        requiredGateKinds: withoutRights,
        gateEvidence: VALID_EXACT_RELEASE_EVIDENCE,
      }) as never,
    );
    expect(evaluation.authorized).toBe(false);
    expect(evaluation.omittedMandatoryGateKinds).toEqual(['RIGHTS']);
    expect(evaluation.missingGateKinds).toEqual([]);
    expect(
      conformanceWithAuthorization(
        publicAuthorizationClaim({
          requiredGateKinds: withoutRights,
          gateEvidence: VALID_EXACT_RELEASE_EVIDENCE,
        }),
      ).overall,
    ).toBe('FAILED');
  });

  it('authorizes the full authoritative set with exact-release evidence (R4)', () => {
    const exact = publicAuthorizationClaim({});
    expect(evaluateDistributionAuthorization(exact as never).authorized).toBe(true);
    expect(evaluateDistributionAuthorization(exact as never).unknownGateKinds).toEqual([]);
    expect(evaluateDistributionAuthorization(exact as never).omittedMandatoryGateKinds).toEqual([]);

    const aggregate = conformanceWithAuthorization(exact);
    expect(aggregate.overall).toBe('PASSED');
    expect(aggregate.findings).toEqual([]);
  });

  /** A compliant bounded live path whose IMPORT_SHADOW_ONLY state is varied. */
  function livePathWithImportState(state: unknown, omit = false): LivePathPrecomputationClaim {
    const boundaryAssertions: ArtifactBoundaryAssertion[] = [];
    for (const assertion of PROD_LIVE_PATH_BOUNDED_CLAIM.boundaryAssertions) {
      if (assertion.assertionKind !== 'IMPORT_SHADOW_ONLY') {
        boundaryAssertions.push(assertion);
        continue;
      }
      const next: Record<string, unknown> = { ...assertion };
      if (omit) delete next['importArtifactState'];
      else next['importArtifactState'] = state;
      boundaryAssertions.push(next as unknown as ArtifactBoundaryAssertion);
    }
    return { ...PROD_LIVE_PATH_BOUNDED_CLAIM, boundaryAssertions };
  }

  function conformanceWithLivePath(livePath: LivePathPrecomputationClaim) {
    return evaluateProdConformance({
      activationClaims: [],
      postureDeclarations: [],
      mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
      livePaths: [livePath],
      distributionAuthorizations: [PROD_WORKSPACE_AUTHORIZED_CLAIM],
    });
  }

  it('fails a live path whose IMPORT_SHADOW_ONLY state is missing, null, unknown, or non-shadow (R7)', () => {
    const missing = livePathWithImportState(undefined, true);
    expect(conformanceWithLivePath(missing).overall).toBe('FAILED');

    for (const state of [
      null,
      'TOTALLY_MADE_UP',
      'RECEIVED',
      'QUARANTINED',
      'SCANNED',
      'REJECTED',
      'ACTIVE',
    ]) {
      const report = conformanceWithLivePath(livePathWithImportState(state));
      expect(report.overall, `import state ${JSON.stringify(state)} must fail closed`).toBe(
        'FAILED',
      );
      expect(report.findings.map((finding) => finding.rule)).toContain(
        PROD_RULES.livePathPrecomputationViolation,
      );
      expect(
        report.findings.some((finding) => finding.message.includes('IMPORT_SHADOW_ONLY')),
      ).toBe(true);
    }
  });

  it('accepts a live path whose IMPORT_SHADOW_ONLY state is VALIDATING or SHADOW_ELIGIBLE (R7)', () => {
    for (const state of ['VALIDATING', 'SHADOW_ELIGIBLE']) {
      const report = conformanceWithLivePath(livePathWithImportState(state));
      expect(report.overall, `import state ${state} must pass`).toBe('PASSED');
      expect(report.findings).toEqual([]);
    }
  });

  it('renders a doubly-pathological import state as a stable placeholder instead of throwing (LOW)', () => {
    // `importArtifactState` is untrusted in-process input. A value whose
    // `toJSON` AND `toString` both throw defeats the `JSON.stringify` fallback
    // and the `String(...)` fallback; the guard must still return a finding
    // rather than crash the whole conformance evaluation.
    const pathological = {
      toJSON() {
        throw new Error('toJSON throws');
      },
      toString() {
        throw new Error('toString throws');
      },
    };
    let report: ReturnType<typeof checkLivePathPrecomputationViolation> | undefined;
    expect(() => {
      report = checkLivePathPrecomputationViolation([livePathWithImportState(pathological)]);
    }).not.toThrow();
    expect(report?.passed).toBe(false);
    const finding = report?.findings.find((candidate) =>
      candidate.message.includes('IMPORT_SHADOW_ONLY must reference an import artifact'),
    );
    expect(finding).toBeDefined();
    expect(finding?.rule).toBe(PROD_RULES.livePathPrecomputationViolation);
    expect(finding?.message).toContain('<unrenderable>');
  });

  it('freezes the domain artifact-boundary kind authority so a spliced kind cannot pass a live path (NEW-H2)', () => {
    const original = [...ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS];
    const mutable = ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS as unknown as string[];
    // BEFORE the fix this `splice` removed IMPORT_SHADOW_ONLY from the module
    // authority, so a live path that omits the import-boundary assertion passed
    // `artifactBoundaryHolds` and R7 accepted it. Pin both the freeze and the
    // refusal outcome.
    let spliced = false;
    try {
      mutable.splice(original.indexOf('IMPORT_SHADOW_ONLY'), 1);
      spliced = true;
    } catch {
      spliced = false;
    }
    try {
      expect(Object.isFrozen(ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS)).toBe(true);
      expect(spliced).toBe(false);
      expect([...ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS]).toEqual(original);
    } finally {
      if (!Object.isFrozen(mutable)) {
        mutable.length = 0;
        for (let index = 0; index < original.length; index += 1) {
          mutable.push(original[index] as string);
        }
      }
    }
    const withoutImportBoundary = {
      ...PROD_LIVE_PATH_BOUNDED_CLAIM,
      boundaryAssertions: PROD_LIVE_PATH_BOUNDED_CLAIM.boundaryAssertions.filter(
        (assertion) => assertion.assertionKind !== 'IMPORT_SHADOW_ONLY',
      ),
    };
    const report = conformanceWithLivePath(withoutImportBoundary);
    expect(report.overall).toBe('FAILED');
    expect(report.findings.map((finding) => finding.rule)).toContain(
      PROD_RULES.livePathPrecomputationViolation,
    );
  });

  it('resists a globally shadowed Array.prototype.includes on every authority membership check (NEW-M4)', () => {
    const originalIncludes = Array.prototype.includes;
    try {
      // A same-process caller can globally replace the method the guards would
      // otherwise use. FAIL-OPEN checks are the §69.9/AC-272 authorization flip
      // and the R7 REJECTED-import acceptance; both must stay closed.
      Array.prototype.includes = () => true;

      const rejected = conformanceWithLivePath(livePathWithImportState('REJECTED'));
      expect(rejected.overall).toBe('FAILED');
      expect(rejected.findings.map((finding) => finding.rule)).toContain(
        PROD_RULES.livePathPrecomputationViolation,
      );

      for (const readiness of ['WORKSPACE_TECHNICALLY_READY', 'PUBLIC_TECHNICALLY_READY']) {
        const evaluation = evaluateDistributionAuthorization(
          publicAuthorizationClaim({ distributionReadiness: readiness }) as never,
        );
        expect(evaluation.readinessAuthorized, readiness).toBe(false);
        expect(evaluation.authorized, readiness).toBe(false);
      }

      const fabricated = evaluateDistributionAuthorization(
        publicAuthorizationClaim({ requiredGateKinds: ['TOTALLY_FAKE_GATE'] }) as never,
      );
      expect(fabricated.authorized).toBe(false);

      expect(() => parseActivationGateKind('TOTALLY_FAKE_GATE')).toThrow();
      expect(() => parseDistributionReadiness('TOTALLY_FAKE_READINESS')).toThrow();
    } finally {
      Array.prototype.includes = originalIncludes;
    }
  });
});

// --- NEW-M5: PROD gate fails closed under Array.prototype shadowing -----------

/**
 * Audit NEW-M5. A same-process caller can globally replace an `Array.prototype`
 * iteration primitive and make `evaluateProdConformance` aggregate ZERO
 * findings (a vacuous `PASSED`) or make the R7 live-path guard report
 * `passed: true` for a live path that omits IMPORT_SHADOW_ONLY. Each shadow is
 * installed for the call under test only and always restored in a `finally`, so
 * the assertions below never run against a shadowed prototype.
 */
describe('NEW-M5: PROD gate fails closed under globally shadowed Array.prototype', () => {
  interface ShadowCase {
    readonly name: string;
    readonly install: () => void;
    readonly restore: () => void;
  }

  function buildShadowCases(): readonly ShadowCase[] {
    const proto = Array.prototype as unknown as Record<string, unknown> & Record<symbol, unknown>;
    const iteratorKey = Symbol.iterator;
    const originalIterator = proto[iteratorKey];
    const cases: ShadowCase[] = [];
    cases[cases.length] = {
      name: 'Array.prototype[Symbol.iterator] = function* () {}',
      install: () => {
        proto[iteratorKey] = function* () {};
      },
      restore: () => {
        proto[iteratorKey] = originalIterator;
      },
    };
    cases[cases.length] = {
      name: 'Array.prototype[Symbol.iterator] = undefined',
      install: () => {
        proto[iteratorKey] = undefined;
      },
      restore: () => {
        proto[iteratorKey] = originalIterator;
      },
    };
    const methodReplacements: readonly (readonly [string, unknown])[] = [
      ['includes', () => true],
      ['map', () => []],
      ['filter', () => []],
      ['some', () => true],
      ['find', () => undefined],
      ['forEach', () => undefined],
      // A no-op `push` silently DROPPED every accumulated finding before the
      // numeric-index fix, so `evaluateProdConformance({})` aggregated zero
      // mandatory-input findings and returned a vacuous `PASSED`.
      ['push', () => 0],
      ['shift', () => undefined],
      ['splice', () => []],
    ];
    for (let index = 0; index < methodReplacements.length; index += 1) {
      const entry = methodReplacements[index] as readonly [string, unknown];
      const methodName = entry[0];
      const replacement = entry[1];
      const original = proto[methodName];
      cases[cases.length] = {
        name: `Array.prototype.${methodName} shadowed`,
        install: () => {
          proto[methodName] = replacement;
        },
        restore: () => {
          proto[methodName] = original;
        },
      };
    }
    return cases;
  }

  const SHADOW_CASES = buildShadowCases();

  function capture<T>(
    shadowCase: ShadowCase,
    run: () => T,
  ): { readonly value: T } | { readonly error: string } {
    shadowCase.install();
    try {
      return { value: run() };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    } finally {
      shadowCase.restore();
    }
  }

  function livePathWithImportState(state: unknown, omit: boolean): LivePathPrecomputationClaim {
    const assertions: ArtifactBoundaryAssertion[] = [];
    for (
      let index = 0;
      index < PROD_LIVE_PATH_BOUNDED_CLAIM.boundaryAssertions.length;
      index += 1
    ) {
      const assertion = PROD_LIVE_PATH_BOUNDED_CLAIM.boundaryAssertions[
        index
      ] as ArtifactBoundaryAssertion;
      if (assertion.assertionKind !== 'IMPORT_SHADOW_ONLY') {
        assertions[assertions.length] = assertion;
        continue;
      }
      const next: Record<string, unknown> = { ...assertion };
      if (omit) delete next['importArtifactState'];
      else next['importArtifactState'] = state;
      assertions[assertions.length] = next as unknown as ArtifactBoundaryAssertion;
    }
    return { ...PROD_LIVE_PATH_BOUNDED_CLAIM, boundaryAssertions: assertions };
  }

  const MISSING_IMPORT_PATH = livePathWithImportState(undefined, true);
  const REJECTED_IMPORT_PATH = livePathWithImportState('REJECTED', false);

  function violatingInput(livePath: LivePathPrecomputationClaim) {
    return {
      activationClaims: [],
      postureDeclarations: [],
      mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
      livePaths: [livePath],
      distributionAuthorizations: [PROD_WORKSPACE_AUTHORIZED_CLAIM],
    };
  }

  function countRule(findings: readonly { readonly rule: string }[], rule: string): number {
    let count = 0;
    for (let index = 0; index < findings.length; index += 1) {
      if ((findings[index] as { readonly rule: string }).rule === rule) count += 1;
    }
    return count;
  }

  it('evaluateProdConformance({}) reports the five mandatory-input findings as FAILED', () => {
    const failures: string[] = [];
    for (let index = 0; index < SHADOW_CASES.length; index += 1) {
      const shadowCase = SHADOW_CASES[index] as ShadowCase;
      const result = capture(shadowCase, () => evaluateProdConformance({}));
      if ('error' in result) {
        failures[failures.length] = `${shadowCase.name}: threw ${result.error}`;
        continue;
      }
      const report = result.value;
      if (report.overall !== 'FAILED') {
        failures[failures.length] = `${shadowCase.name}: overall ${report.overall}`;
      }
      const missingCount = countRule(report.findings, PROD_RULES.prodConformanceInputMissing);
      if (missingCount !== 5) {
        failures[failures.length] = `${shadowCase.name}: missing-input findings ${missingCount}`;
      }
    }
    expect(failures).toEqual([]);
  });

  it('a live path missing IMPORT_SHADOW_ONLY or with a REJECTED state FAILS with R7', () => {
    const failures: string[] = [];
    const paths: readonly (readonly [string, LivePathPrecomputationClaim])[] = [
      ['missing IMPORT_SHADOW_ONLY', MISSING_IMPORT_PATH],
      ['REJECTED import state', REJECTED_IMPORT_PATH],
    ];
    for (let index = 0; index < SHADOW_CASES.length; index += 1) {
      const shadowCase = SHADOW_CASES[index] as ShadowCase;
      const direct = capture(shadowCase, () =>
        checkLivePathPrecomputationViolation([MISSING_IMPORT_PATH]),
      );
      if ('error' in direct) {
        failures[failures.length] = `${shadowCase.name}: direct threw ${direct.error}`;
      } else {
        if (direct.value.passed !== false) {
          failures[failures.length] = `${shadowCase.name}: direct passed ${String(
            direct.value.passed,
          )}`;
        }
        if (countRule(direct.value.findings, PROD_RULES.livePathPrecomputationViolation) < 1) {
          failures[failures.length] = `${shadowCase.name}: direct has no R7 finding`;
        }
      }
      for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
        const entry = paths[pathIndex] as readonly [string, LivePathPrecomputationClaim];
        const aggregated = capture(shadowCase, () =>
          evaluateProdConformance(violatingInput(entry[1])),
        );
        if ('error' in aggregated) {
          failures[failures.length] = `${shadowCase.name} (${entry[0]}): threw ${aggregated.error}`;
          continue;
        }
        const report = aggregated.value;
        if (report.overall !== 'FAILED') {
          failures[failures.length] = `${shadowCase.name} (${entry[0]}): overall ${report.overall}`;
        }
        if (countRule(report.findings, PROD_RULES.livePathPrecomputationViolation) < 1) {
          failures[failures.length] = `${shadowCase.name} (${entry[0]}): no R7 finding`;
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('a conforming corpus still PASSES (no false failure)', () => {
    const failures: string[] = [];
    for (let index = 0; index < SHADOW_CASES.length; index += 1) {
      const shadowCase = SHADOW_CASES[index] as ShadowCase;
      const result = capture(shadowCase, () =>
        evaluateProdConformance(violatingInput(PROD_LIVE_PATH_BOUNDED_CLAIM)),
      );
      if ('error' in result) {
        failures[failures.length] = `${shadowCase.name}: threw ${result.error}`;
      } else if (result.value.overall !== 'PASSED') {
        failures[failures.length] = `${shadowCase.name}: overall ${result.value.overall}`;
      }
    }
    expect(failures).toEqual([]);
  });
});

// --- NEW-N2: no app-level array destructuring on the aggregation path ---------

/**
 * Audit N2. `evaluateConformance` read its four rule verdicts with
 * `const [mapping, activePaths, premature, generated] = await Promise.all([…])`.
 * Language-level array destructuring reads `Array.prototype[Symbol.iterator]` on
 * the settled result array, so a same-process caller can install a SURGICAL
 * iterator that delegates to the original for every other array but forges four
 * empty verdicts for the four-element Promise.all result. Before the
 * numeric-index fix (parent 4c68856) that flipped a FAILED trace violation to a
 * vacuous `PASSED` with zero findings. Each shadow is installed only for the
 * call under test and always restored in a `finally`.
 */
describe('NEW-N2: conformance aggregation resists a surgical Symbol.iterator shadow', () => {
  const ITERATOR_KEY = Symbol.iterator;

  /**
   * Installs a shadowed `Array.prototype[Symbol.iterator]` that forges empty rule
   * verdicts ONLY for a four-element array whose every element carries a
   * `findings` collection (the `Promise.all` result shaped like the four trace
   * verdicts), and delegates to the original iterator otherwise.
   *
   * The returned forged iterator is a hand-built `next()` protocol object: it
   * must NOT touch `[Symbol.iterator]` itself, or it would re-enter the shadow.
   */
  function installSurgicalIterator(): () => void {
    const proto = Array.prototype as unknown as Record<symbol, unknown>;
    const original = proto[ITERATOR_KEY];
    function isRuleVerdictArray(value: unknown): boolean {
      if (!Array.isArray(value) || value.length !== 4) return false;
      for (let index = 0; index < 4; index += 1) {
        const element = (value as unknown[])[index];
        if (
          element === null ||
          typeof element !== 'object' ||
          !('findings' in (element as object))
        ) {
          return false;
        }
      }
      return true;
    }
    function forgedIterator(): { next: () => { value: unknown; done: boolean } } {
      const forged = {
        passed: true,
        findings: [],
        unmappedItems: [],
        missingPaths: [],
        prematurePaths: [],
        driftedFiles: [],
      };
      const values: unknown[] = [forged, forged, forged, forged];
      let index = 0;
      return {
        next: () => {
          if (index < values.length) {
            const value = values[index];
            index += 1;
            return { value, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    }
    proto[ITERATOR_KEY] = function (this: unknown) {
      if (isRuleVerdictArray(this)) return forgedIterator();
      return (original as (this: unknown) => unknown).call(this);
    };
    return () => {
      proto[ITERATOR_KEY] = original;
    };
  }

  async function evaluateUnderSurgicalIterator(
    options: ConformanceOptions,
  ): Promise<ConformanceResult> {
    const restore = installSurgicalIterator();
    try {
      return await evaluateConformance(options);
    } finally {
      restore();
    }
  }

  // A single injected G2 requirement whose implementationRef resolves to no
  // repository path, so the ACTIVE-implementation trace rule emits a finding
  // deterministically (independent of the live manifest's contents).
  const N2_TRACE_VIOLATION_REQUIREMENT: RequirementMapping = {
    id: 'FR-MOCK-N2-001',
    dependencyGroup: 'G2',
    implementationRefs: ['packages/n2-missing-surface/src/index.ts @requirement FR-MOCK-N2-001'],
    testRefs: ['tests/acceptance/AC-266.spec.ts'],
    owner: 'packages/release-conformance',
  };
  // A fully compliant PROD claim set, so the PROD block contributes zero
  // findings and the ONLY failure is the trace violation above: that is exactly
  // the corpus the forge would otherwise silence.
  const N2_COMPLIANT_PROD_CLAIMS = {
    activationClaims: [PROD_COMPLIANT_ACTIVE_CLAIM],
    postureDeclarations: [PROD_BEST_EFFORT_COMPLIANT],
    mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
    livePaths: [PROD_LIVE_PATH_BOUNDED_CLAIM],
    distributionAuthorizations: [PROD_WORKSPACE_AUTHORIZED_CLAIM, PROD_TECHNICALLY_READY_CLAIM],
  };

  it('does not let forged verdicts flip a trace-violating corpus to PASSED (N2)', async () => {
    const options: ConformanceOptions = {
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      requirements: [N2_TRACE_VIOLATION_REQUIREMENT],
      prodClaims: N2_COMPLIANT_PROD_CLAIMS,
    };
    const baseline = await evaluateConformance(options);
    expect(baseline.overall).toBe('FAILED');
    expect(baseline.findings.map((finding) => finding.rule)).toContain(
      CONFORMANCE_RULES.activePath,
    );

    const attacked = await evaluateUnderSurgicalIterator(options);
    expect(attacked.overall).toBe('FAILED');
    expect(attacked.findings.length).toBeGreaterThan(0);
    expect(attacked.findings.map((finding) => finding.rule)).toContain(
      CONFORMANCE_RULES.activePath,
    );
  });

  it('keeps the PROD findings present while the iterator is shadowed (N2)', async () => {
    const attacked = await evaluateUnderSurgicalIterator({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      prodClaims: {
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [PROD_BEST_EFFORT_WEAKENING],
        mcpCompatibility: PROD_MCP_DRAFT_DEFAULT_CLAIM,
        livePaths: [PROD_LIVE_PATH_NO_BOUND_CLAIM],
        distributionAuthorizations: [PROD_PUBLIC_AUTHORIZED_MISSING_CLAIM],
      },
    });
    expect(attacked.overall).toBe('FAILED');
    expect(attacked.findings.map((finding) => finding.rule)).toContain(
      PROD_RULES.activationWithoutEvidence,
    );
  });
});
