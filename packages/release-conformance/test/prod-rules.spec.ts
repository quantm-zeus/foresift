/**
 * PROD release-conformance rule suite (T032, FR-PROD-001…006, AC-144/152/
 * 272/273/275/276/277/278/279).
 *
 * Every PROD rule must detect its violation and accept compliant input, and the
 * four pre-existing trace rules must keep passing unchanged.
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CLAIM_PROD_RULES,
  promiseAllNumeric,
  CONFORMANCE_RULES,
  GATE_KINDS,
  PROD_RULES,
  buildReleaseReport,
  checkActivationWithoutEvidence,
  checkProdSurfacePresence,
  checkLivePathPrecomputationViolation,
  checkMcpCompatibilityDrift,
  checkPostureWeakening,
  checkPublicAuthorizationWithoutGateEvidence,
  detectOrphanSources,
  evaluateConformance,
  evaluateDistributionAuthorization,
  evaluateProdConformance,
  SHADOW_ONLY_IMPORT_ARTIFACT_STATES,
  type ConformanceOptions,
  type ConformanceResult,
  type LivePathPrecomputationClaim,
  type RequirementMapping,
} from '../src/index.ts';
import { VALID_RELEASE_REPORT_FIXTURE } from '../../../tests/fixtures/trace/index.ts';
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

/**
 * V7-F8 fail-open: the release rule certified a PASS cell from `result` +
 * `liveTestDate` alone, while the DB resolver (`isMutuallyTested`) requires a
 * passing conformance RUN whose `fixtureRef` matches the cell. A cell claiming
 * PASS with no run/fixture reference therefore certified a default the server
 * refuses to serve.
 */
describe('V7 fail-open: MCP compatibility requires conformance-run provenance (F8)', () => {
  const cellBase = {
    revision: '2025-11-25',
    clientId: 'client-a',
    result: 'PASS',
    liveTestDate: '2026-05-01T00:00:00Z',
    conformanceRunId: 'run-2025-11-25-client-a',
    fixtureRef: 'fixture-client-a',
  };
  const claimFor = (cell: Record<string, unknown>) => ({
    revisions: [
      { revision: '2025-11-25', channel: 'STABLE', isDefault: true, supersededBy: null },
    ],
    clients: [{ clientId: 'client-a' }],
    cells: [cell],
    now: '2026-06-01T00:00:00Z',
  });

  it('(a) drifts a PASS cell whose conformanceRunId is missing or empty', () => {
    const missing = checkMcpCompatibilityDrift(
      claimFor({ ...cellBase, conformanceRunId: undefined }) as never,
    );
    expect(missing.passed).toBe(false);
    expect(missing.findings.some((f) => f.rule === PROD_RULES.mcpCompatibilityDrift)).toBe(true);

    const empty = checkMcpCompatibilityDrift(
      claimFor({ ...cellBase, conformanceRunId: '' }) as never,
    );
    expect(empty.passed).toBe(false);
    expect(empty.findings.some((f) => f.rule === PROD_RULES.mcpCompatibilityDrift)).toBe(true);
  });

  it('(b) drifts a PASS cell whose fixtureRef is missing or empty', () => {
    const empty = checkMcpCompatibilityDrift(claimFor({ ...cellBase, fixtureRef: '' }) as never);
    expect(empty.passed).toBe(false);
    expect(empty.findings.some((f) => f.rule === PROD_RULES.mcpCompatibilityDrift)).toBe(true);
  });

  it('(c) CONTROL: a provenance-complete fresh PASS cell still passes', () => {
    expect(checkMcpCompatibilityDrift(claimFor(cellBase) as never).passed).toBe(true);
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
      conformanceRunId: 'run-2025-11-25-client-a',
      fixtureRef: 'fixture-client-a',
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

  /**
   * V6-3 (sixth-round verification). Presence was checked for the posture
   * dimension fields but not their shape, so `weakenedDimensions: { length: 0 }`
   * was read by the numeric scan as "declares zero weakening" and a fully
   * compliant posture corpus reached PASSED.
   *
   * The corpus below is otherwise compliant and uses the exact domain
   * vocabulary (lowercase posture and dimension values, every protected
   * dimension asserted), so the ONLY finding it can produce is the V6-3 shape
   * guard — and at `29f1841` it produced none.
   */
  const compliantPostureCorpus = (weakenedDimensions: unknown): unknown => ({
    activationClaims: [],
    postureDeclarations: [
      {
        declarationId: 'v6-posture',
        requirementId: 'FR-PROD-004',
        posture: 'FREE_TIER_BEST_EFFORT',
        weakenedDimensions,
        protectedDimensions: [
          'identity',
          'point_in_time',
          'audit',
          'duplicate_prevention',
          'security',
          'execution_semantics',
          'capacity',
          'critical_risk_monitoring',
          'claim_boundaries',
        ],
      },
    ],
    mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
    livePaths: [],
    distributionAuthorizations: [],
  });

  it('requires the posture dimension fields to be arrays (V6-3)', () => {
    const attacked = evaluateProdConformance(compliantPostureCorpus({ length: 0 }) as never);
    expect(attacked.overall).toBe('FAILED');
    const paths = attacked.findings
      .filter((finding) => finding.rule === PROD_RULES.prodConformanceInputMissing)
      .map((finding) => finding.path);
    expect(paths).toContain('postureDeclarations[0].weakenedDimensions');

    // An array-like with real indexed content was equally inadmissible.
    const arrayLike = evaluateProdConformance(
      compliantPostureCorpus({ 0: 'freshness', length: 1 }) as never,
    );
    expect(arrayLike.overall).toBe('FAILED');
    expect(
      arrayLike.findings
        .filter((finding) => finding.rule === PROD_RULES.prodConformanceInputMissing)
        .map((finding) => finding.path),
    ).toContain('postureDeclarations[0].weakenedDimensions');
  });

  it('keeps a well-shaped posture declaration admissible (V6-3 no over-refusal)', () => {
    const report = evaluateProdConformance(compliantPostureCorpus(['freshness']) as never);
    // The corpus is compliant in every other respect, so a PASSED report here is
    // the proof that the V6-3 guard does not over-refuse a genuine declaration.
    expect(report.overall).toBe('PASSED');
    expect(report.findings).toEqual([]);
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
    // Two full `evaluateConformance` passes over the live tree measured 4983 ms
    // against bun's 5000 ms default: an explicit bound keeps the release-gate
    // regression deterministic under concurrent load (audit R-round test flake).
  }, 120_000);

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
  }, 120_000);
});

// --- NEW-N3: no reliance on the Promise.all ARGUMENT array's iterator ---------

/**
 * Audit N3 (HIGH). The NEW-N2 fix replaced app-level array destructuring with
 * numeric index reads, which closed only the SETTLED-array vector.
 * `Promise.all(iterable)` ALSO reads `Array.prototype[Symbol.iterator]` on its
 * ARGUMENT array, so a surgical iterator can substitute forged RESOLVED values
 * before any numeric read happens: a FAILED G2 corpus becomes a vacuous PASSED,
 * `buildReleaseReport` hashes an empty document/manifest (`sha256('')`), and a
 * real orphan is silenced.
 *
 * The package now routes every `Promise.all` argument through
 * `promiseAllNumeric` (see `src/shadow-safe.ts`), which copies by numeric index
 * and installs its own captured `Symbol.iterator` on the array handed to the
 * builtin. The shadow below forges ONLY the array whose immediate caller frame
 * is the targeted function AND whose shape matches the targeted argument, and it
 * is always restored in a `finally`.
 */
describe('NEW-N3: Promise.all argument arrays resist a surgical Symbol.iterator shadow', () => {
  const ITERATOR_KEY = Symbol.iterator;
  const SHA256_EMPTY = createHash('sha256').update('').digest('hex');

  interface SurgicalTarget {
    readonly frame: string;
    readonly accepts: (value: unknown[]) => boolean;
    readonly forge: () => readonly unknown[];
  }

  function thenableArrayOfLength(length: number): (value: unknown[]) => boolean {
    return (value) => {
      if (value.length !== length) return false;
      for (let index = 0; index < value.length; index += 1) {
        const element = value[index];
        if (
          element === null ||
          (typeof element !== 'object' && typeof element !== 'function') ||
          typeof (element as { then?: unknown }).then !== 'function'
        ) {
          return false;
        }
      }
      return true;
    };
  }

  function anyNonEmptyThenableArray(value: unknown[]): boolean {
    return value.length > 0 && thenableArrayOfLength(value.length)(value);
  }

  /**
   * The function that directly called `Promise.all`: the frame immediately after
   * the native `at all (unknown)` frame. Substring-matching the whole stack is
   * NOT surgical enough, because a targeted caller (e.g. `evaluateConformance`)
   * also appears transitively above `generateOutputs`' own `Promise.all`.
   */
  function immediatePromiseAllCaller(): string | undefined {
    const stack = new Error().stack;
    if (typeof stack !== 'string') return undefined;
    const lines = stack.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      if (/at (?:Promise\.)?all \(/.test(line)) {
        const caller = lines[index + 1];
        if (caller === undefined) return undefined;
        const match = caller.match(/at\s+([A-Za-z0-9_$.]+)\s*\(/);
        return match?.[1];
      }
    }
    return undefined;
  }

  function installSurgicalArgumentIterator(target: SurgicalTarget): () => void {
    const proto = Array.prototype as unknown as Record<symbol, unknown>;
    const original = proto[ITERATOR_KEY] as (this: unknown) => unknown;
    proto[ITERATOR_KEY] = function (this: unknown) {
      if (
        Array.isArray(this) &&
        target.accepts(this as unknown[]) &&
        immediatePromiseAllCaller() === target.frame
      ) {
        const values = target.forge();
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
      return (original as (this: unknown) => unknown).call(this);
    };
    return () => {
      proto[ITERATOR_KEY] = original;
    };
  }

  async function underShadow<T>(target: SurgicalTarget, run: () => Promise<T>): Promise<T> {
    const restore = installSurgicalArgumentIterator(target);
    try {
      return await run();
    } finally {
      restore();
    }
  }

  function forgedRuleVerdict(): Record<string, unknown> {
    return {
      passed: true,
      findings: [],
      unmappedItems: [],
      missingPaths: [],
      prematurePaths: [],
      driftedFiles: [],
    };
  }

  /**
   * The committed `docs/generated` bytes, read once and injected as the expected
   * snapshot. This keeps the N3 regressions on the fast path: otherwise
   * `checkGeneratedDocsDrift` runs the canonical generator, whose own
   * four-element `Promise.all` argument is a second site reached transitively
   * under the same shadow (its immediate caller is `generateOutputs`, so it is
   * deliberately NOT forged) and would make the test needlessly slow.
   */
  let cachedGeneratedSnapshot: Record<string, Uint8Array> | undefined;
  async function generatedSnapshot(): Promise<Record<string, Uint8Array>> {
    if (cachedGeneratedSnapshot !== undefined) return cachedGeneratedSnapshot;
    const generatedRoot = path.join(REPO_ROOT, 'docs/generated');
    const snapshot: Record<string, Uint8Array> = {};
    const visit = async (relative: string): Promise<void> => {
      const entries = await readdir(path.join(generatedRoot, relative), { withFileTypes: true });
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index] as (typeof entries)[number];
        const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) await visit(child);
        else if (entry.isFile()) snapshot[child] = await readFile(path.join(generatedRoot, child));
      }
    };
    await visit('');
    cachedGeneratedSnapshot = snapshot;
    return snapshot;
  }

  // A single injected G2 requirement whose implementationRef resolves to no
  // repository path, so the ACTIVE-implementation trace rule emits one finding.
  const N3_TRACE_VIOLATION_REQUIREMENT: RequirementMapping = {
    id: 'FR-MOCK-001',
    dependencyGroup: 'G2',
    implementationRefs: ['packages/n3-missing-surface/src/index.ts @requirement FR-MOCK-001'],
    testRefs: ['tests/acceptance/AC-266.spec.ts'],
    owner: 'packages/release-conformance',
  };
  // A fully compliant PROD claim set, so the ONLY failure in the attacked corpus
  // is the trace violation the forge is trying to silence.
  const N3_COMPLIANT_PROD_CLAIMS = {
    activationClaims: [PROD_COMPLIANT_ACTIVE_CLAIM],
    postureDeclarations: [PROD_BEST_EFFORT_COMPLIANT],
    mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
    livePaths: [PROD_LIVE_PATH_BOUNDED_CLAIM],
    distributionAuthorizations: [PROD_WORKSPACE_AUTHORIZED_CLAIM, PROD_TECHNICALLY_READY_CLAIM],
  };

  it('does not let a forged Promise.all ARGUMENT flip a trace-violating G2 corpus to PASSED (N3)', async () => {
    const options: ConformanceOptions = {
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      requirements: [N3_TRACE_VIOLATION_REQUIREMENT],
      prodClaims: N3_COMPLIANT_PROD_CLAIMS,
      expectedGeneratedFiles: await generatedSnapshot(),
    };
    const baseline = await evaluateConformance(options);
    expect(baseline.overall).toBe('FAILED');
    expect(baseline.findings.map((finding) => finding.rule)).toContain(
      CONFORMANCE_RULES.activePath,
    );

    const attacked = await underShadow(
      {
        frame: 'evaluateConformance',
        accepts: thenableArrayOfLength(4),
        forge: () => [
          forgedRuleVerdict(),
          forgedRuleVerdict(),
          forgedRuleVerdict(),
          forgedRuleVerdict(),
        ],
      },
      () => evaluateConformance(options),
    );
    expect(attacked.overall).toBe('FAILED');
    expect(attacked.findings.length).toBeGreaterThan(0);
    expect(attacked.findings.map((finding) => finding.rule)).toContain(
      CONFORMANCE_RULES.activePath,
    );
  }, 120_000);

  it('keeps the unshadowed controls: the failing corpus is FAILED and a conforming corpus is PASSED (N3)', async () => {
    const expectedGeneratedFiles = await generatedSnapshot();
    const failing = await evaluateConformance({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      requirements: [N3_TRACE_VIOLATION_REQUIREMENT],
      prodClaims: N3_COMPLIANT_PROD_CLAIMS,
      expectedGeneratedFiles,
    });
    expect(failing.overall).toBe('FAILED');
    expect(failing.findings.length).toBeGreaterThan(0);

    const conforming = await evaluateConformance({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      requirements: [],
      prodClaims: N3_COMPLIANT_PROD_CLAIMS,
      expectedGeneratedFiles,
    });
    expect(conforming.overall).toBe('PASSED');
    expect(conforming.findings.length).toBe(0);
  }, 120_000);

  it('hashes the real document/manifest when the buildReleaseReport Promise.all ARGUMENT is forged (N3)', async () => {
    const options = {
      repoRoot: REPO_ROOT,
      milestone: 'G0',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
    };
    const baseline = await buildReleaseReport(options);
    expect(baseline.documentHash).not.toBe(SHA256_EMPTY);

    const attacked = await underShadow(
      {
        frame: 'buildReleaseReport',
        accepts: thenableArrayOfLength(7),
        forge: () => [
          '',
          '',
          {
            hashes: {
              documentArtifactSha256: SHA256_EMPTY,
              requirementManifestSha256: SHA256_EMPTY,
              documentNormalizedSha256: SHA256_EMPTY,
            },
            auditDate: '2026-01-01',
          },
          { inventoryHash: SHA256_EMPTY },
          {},
          {},
          { schemaVersion: '1.0.0', exceptions: [] },
        ],
      },
      () => buildReleaseReport(options),
    );
    expect(attacked.documentHash).toBe(baseline.documentHash);
    expect(attacked.manifestHash).toBe(baseline.manifestHash);
    expect(attacked.documentHash).not.toBe(SHA256_EMPTY);
    expect(attacked.manifestHash).not.toBe(SHA256_EMPTY);
  }, 120_000);

  it('keeps migration/schema hashes when the hashFiles Promise.all ARGUMENT is forged (N3)', async () => {
    const options = {
      repoRoot: REPO_ROOT,
      milestone: 'G0',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
    };
    const baseline = await buildReleaseReport(options);
    expect(Object.keys(baseline.migrationHashes).length).toBeGreaterThan(0);
    expect(Object.keys(baseline.schemaHashes).length).toBeGreaterThan(0);

    const attacked = await underShadow(
      { frame: 'hashFiles', accepts: anyNonEmptyThenableArray, forge: () => [] },
      () => buildReleaseReport(options),
    );
    expect(attacked.migrationHashes).toEqual(baseline.migrationHashes);
    expect(attacked.schemaHashes).toEqual(baseline.schemaHashes);
  }, 120_000);

  async function createOrphanFixtureRepo(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'n3-orphan-'));
    await mkdir(path.join(root, 'docs/spec'), { recursive: true });
    await mkdir(path.join(root, 'packages/orphan/src'), { recursive: true });
    await mkdir(path.join(root, 'packages/release-conformance/src'), { recursive: true });
    await writeFile(
      path.join(
        root,
        'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
      ),
      JSON.stringify({ requirements: [] }),
    );
    await writeFile(
      path.join(root, 'packages/orphan/src/index.ts'),
      'export const orphan = true;\n',
    );
    await writeFile(
      path.join(root, 'packages/release-conformance/src/orphan-exceptions.json'),
      JSON.stringify({ schemaVersion: '1.0.0', exceptions: [] }),
    );
    return root;
  }

  it('still reports a real orphan when the outer 3-element Promise.all ARGUMENT is forged (N3)', async () => {
    const root = await createOrphanFixtureRepo();
    try {
      const baseline = await detectOrphanSources({ repoRoot: root });
      expect(baseline.passed).toBe(false);
      expect(baseline.unexemptedOrphans).toContain('packages/orphan/src/index.ts');

      const outerForged = await underShadow(
        {
          frame: 'detectOrphanSources',
          accepts: thenableArrayOfLength(3),
          forge: () => [[], [], []],
        },
        () => detectOrphanSources({ repoRoot: root }),
      );
      expect(outerForged.passed).toBe(false);
      expect(outerForged.unexemptedOrphans).toContain('packages/orphan/src/index.ts');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('still reports a real orphan when the inner 2-element Promise.all ARGUMENT is forged (N3)', async () => {
    const root = await createOrphanFixtureRepo();
    try {
      const baseline = await detectOrphanSources({ repoRoot: root });
      expect(baseline.passed).toBe(false);
      expect(baseline.unexemptedOrphans).toContain('packages/orphan/src/index.ts');

      const innerForged = await underShadow(
        {
          frame: 'detectOrphanSources',
          accepts: thenableArrayOfLength(2),
          forge: () => [
            {
              schemaVersion: '1.0.0',
              exceptions: [
                {
                  pathPattern: 'packages/orphan/src/**',
                  servingRequirementIds: ['FR-MOCK-001'],
                  justification: 'forged exemption',
                },
              ],
            },
            { implementationRefs: [], requirementIds: new Set(['FR-MOCK-001']) },
          ],
        },
        () => detectOrphanSources({ repoRoot: root }),
      );
      expect(innerForged.passed).toBe(false);
      expect(innerForged.unexemptedOrphans).toContain('packages/orphan/src/index.ts');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});

/**
 * R12 (audit fifth round). `SHADOW_ONLY_IMPORT_ARTIFACT_STATES` was built with
 * `Array.prototype.filter` at module initialization, and `conformance.ts`
 * imports `prod-rules.ts` DYNAMICALLY at call time. A shadow installed before
 * `evaluateConformance` ran therefore controlled the constructor: a `filter`
 * that returned its receiver widened the authority to every persisted state, so
 * an `IMPORT_SHADOW_ONLY` assertion naming a `RECEIVED`/`REJECTED` import passed
 * the release gate (re-opening H4/R7).
 *
 * Module initialization cannot be re-run in-process once another spec file has
 * imported the module, so the regression runs the probe in a FRESH bun process:
 * it shadows `filter`, dynamically imports the module, and reports the authority
 * it observed. Pre-fix the probe prints `WIDENED:[…]`; the numeric selection
 * prints `OK`.
 */
describe('R12: the release-side import-shadow authority resists a module-init filter shadow', () => {
  it('keeps the shadow-only import state set exact under a pre-import filter shadow', () => {
    const modulePath = path.resolve(REPO_ROOT, 'packages/release-conformance/src/prod-rules.ts');
    const probe = [
      'const originalFilter = Array.prototype.filter;',
      'Array.prototype.filter = function (callback, thisArg) {',
      '  // Surgical: only widen the specific shadow-only selection callback, so',
      "  // the bun runtime's own array work is untouched.",
      "  if (typeof callback === 'function' && String(callback).includes('VALIDATING')) {",
      '    return this;',
      '  }',
      '  return originalFilter.call(this, callback, thisArg);',
      '};',
      'void (async () => {',
      `  const mod = await import(${JSON.stringify(modulePath)});`,
      '  const states = mod.SHADOW_ONLY_IMPORT_ARTIFACT_STATES;',
      "  const ok = states.length === 2 && states[0] === 'VALIDATING' && states[1] === 'SHADOW_ELIGIBLE';",
      "  process.stdout.write(ok ? 'OK' : 'WIDENED:' + JSON.stringify(states));",
      '  process.exit(0);',
      '})().catch(async (error) => {',
      "  process.stdout.write('ERROR:' + String(error));",
      '  process.exit(1);',
      '});',
    ].join('\n');
    const result = spawnSync(process.execPath, ['-e', probe], {
      cwd: path.resolve(REPO_ROOT),
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(result.status).toBe(0);
    expect((result.stdout ?? '').trim()).toBe('OK');
  }, 120_000);
});

/**
 * V7 accessor class: a caller object whose property is a getter must not be able
 * to present one value to an authorization/validity check and a different value
 * to the value that is consumed or persisted.
 */
describe('V7: caller accessors cannot flip a release-gate decision', () => {
  it('binds options.requirements once, so a getter cannot skip the PROD block (V7-A1)', async () => {
    let reads = 0;
    const options = {
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      get requirements() {
        reads += 1;
        return reads === 1 ? [] : undefined;
      },
      prodClaims: {
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      },
    };
    const result = await evaluateConformance(options as never);
    // The snapshot reads `requirements` once; the authoritative manifest still
    // decides ownership, so the PROD block runs and the violating claim FAILS.
    expect(reads).toBe(1);
    expect(result.overall).toBe('FAILED');
    const rules = new Set(result.findings.map((finding) => finding.rule));
    expect(rules).toContain(PROD_RULES.activationWithoutEvidence);
  }, 120_000);

  it('refuses a class-instance options carrier instead of reading its live getters (V7 round 6)', async () => {
    // A class getter lives on the PROTOTYPE, so an own-property scan misses it.
    // The first cut of the systemic fix passed class instances through by
    // reference, re-opening the release-gate FAILED -> PASSED downgrade.
    class OptionsCarrier {
      readonly repoRoot = REPO_ROOT;
      readonly milestone = 'G2';
      readonly prodClaims = {
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      };
      requirementsReads = 0;
      get requirements(): unknown {
        this.requirementsReads += 1;
        return this.requirementsReads === 1 ? [] : undefined;
      }
    }
    const carrier = new OptionsCarrier();
    const result = await evaluateConformance(carrier as never);
    expect(result.overall).toBe('FAILED');
    // The non-plain carrier is refused BEFORE any property read, so the live
    // prototype getter never runs (the pass-through cut read it).
    expect(carrier.requirementsReads).toBe(0);
  }, 120_000);

  it('refuses a getPrototypeOf-trap Proxy carrier (V7 round 6)', async () => {
    const target: Record<string, unknown> = {
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      prodClaims: {
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      },
    };
    let reads = 0;
    Object.defineProperty(target, 'requirements', {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? [] : undefined;
      },
    });
    const trapped = new Proxy(target, {
      getPrototypeOf: () => class Trap {}.prototype,
    });
    const result = await evaluateConformance(trapped as never);
    expect(result.overall).toBe('FAILED');
    expect(reads).toBe(0);
  }, 120_000);

  it('refuses a getPrototypeOf-trap Proxy claiming Uint8Array.prototype (V7 round 7)', async () => {
    const target: Record<string, unknown> = {
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      prodClaims: {
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      },
    };
    let reads = 0;
    Object.defineProperty(target, 'requirements', {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return [];
      },
    });
    // A Proxy has no typed-array internal slot, so the captured length getter
    // fails and the carrier is refused rather than copied by reference.
    const trapped = new Proxy(target, { getPrototypeOf: () => Uint8Array.prototype });
    const result = await evaluateConformance(trapped as never);
    expect(result.overall).toBe('FAILED');
    expect(reads).toBe(0);
  }, 120_000);

  it('fails closed when Array.prototype carries an integer-index accessor (V7 round 7)', () => {
    // An index setter swallows `array[array.length] = value`, the numeric-append
    // pattern used by the authority collectors, so a FAILED verdict could read
    // as PASSED. The snapshot boundary detects it and fails closed.
    Object.defineProperty(Array.prototype, '0', { configurable: true, set() {} });
    try {
      const report = evaluateProdConformance({
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      });
      expect(report.overall).toBe('FAILED');
    } finally {
      delete (Array.prototype as unknown as Record<string, unknown>)['0'];
    }
  }, 120_000);

  it('fails closed when an INHERITED prototype carries an integer-index accessor (V7 round 8)', () => {
    Object.defineProperty(Object.prototype, '0', { configurable: true, set() {} });
    try {
      const report = evaluateProdConformance({
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      });
      expect(report.overall).toBe('FAILED');
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>)['0'];
    }
  }, 120_000);

  it('fails closed when Array.prototype inherits an integer-index accessor (V7 round 8)', () => {
    const original = Object.getPrototypeOf(Array.prototype) as object;
    const hostile = Object.create(original) as Record<string, unknown>;
    Object.defineProperty(hostile, '0', { configurable: true, set() {} });
    Object.setPrototypeOf(Array.prototype, hostile);
    try {
      const report = evaluateProdConformance({
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      });
      expect(report.overall).toBe('FAILED');
    } finally {
      Object.setPrototypeOf(Array.prototype, original);
    }
  }, 120_000);

  it('fails closed when a hostile index accessor sits beyond a long prototype chain (V7 round 9)', () => {
    const originalArrayProto = Object.getPrototypeOf(Array.prototype) as object;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, '0', { configurable: true, set() {} });
    let chain: object = hostile;
    for (let hop = 0; hop < 40; hop += 1) chain = Object.create(chain) as object;
    Object.setPrototypeOf(Array.prototype, chain);
    try {
      const report = evaluateProdConformance({
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      });
      expect(report.overall).toBe('FAILED');
    } finally {
      Object.setPrototypeOf(Array.prototype, originalArrayProto);
    }
  }, 120_000);

  it('fails closed when Array.prototype inherits a swallowing Proxy (V7 round 9)', () => {
    const originalArrayProto = Object.getPrototypeOf(Array.prototype) as object;
    const hostile = new Proxy(Object.create(null) as object, {
      set: () => true,
    });
    Object.setPrototypeOf(Array.prototype, hostile);
    try {
      const report = evaluateProdConformance({
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      });
      expect(report.overall).toBe('FAILED');
    } finally {
      Object.setPrototypeOf(Array.prototype, originalArrayProto);
    }
  }, 120_000);

  it('defines settled-promise entries as own properties, immune to a deep-chain accessor (V7 round 10)', async () => {
    const originalArrayProto = Object.getPrototypeOf(Array.prototype) as object;
    const hostile = Object.create(null) as Record<string, unknown>;
    for (let index = 0; index < 4; index += 1) {
      Object.defineProperty(hostile, String(index), {
        configurable: true,
        get() {
          return 'FABRICATED';
        },
        set() {},
      });
    }
    let chain: object = hostile;
    for (let hop = 0; hop < 40; hop += 1) chain = Object.create(chain) as object;
    Object.setPrototypeOf(Array.prototype, chain);
    try {
      const settled = await promiseAllNumeric([Promise.resolve('A'), Promise.resolve('B')]);
      // `appendSafe` creates own data properties, so the inherited accessor
      // cannot swallow the entries or fabricate their values.
      expect(settled.length).toBe(2);
      expect(settled[0]).toBe('A');
      expect(settled[1]).toBe('B');
    } finally {
      Object.setPrototypeOf(Array.prototype, originalArrayProto);
    }
  }, 120_000);

  it('evaluates the VALIDATED milestone, so a getter cannot downgrade G2 to G0 (V7 round 9)', async () => {
    let reads = 0;
    const options = {
      repoRoot: REPO_ROOT,
      get milestone(): string {
        reads += 1;
        return reads === 1 ? 'G2' : 'G0';
      },
      prodClaims: {
        activationClaims: [PROD_ACTIVE_WITHOUT_GATE_CLAIM],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [],
        distributionAuthorizations: [],
      },
    };
    const result = await evaluateConformance(options as never);
    expect(result.overall).toBe('FAILED');
    expect(result.findings.map((finding) => finding.rule)).toContain(
      PROD_RULES.activationWithoutEvidence,
    );
  }, 120_000);

  it('binds each claim field once, so a getter cannot hide a violation (V7-A8)', () => {
    let reads = 0;
    const claims = [PROD_ACTIVE_WITHOUT_GATE_CLAIM];
    // Define the getter on the FINAL object: object spread would evaluate it
    // once at construction and copy a plain value.
    const input: Record<string, unknown> = {
      postureDeclarations: [],
      mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
      livePaths: [],
      distributionAuthorizations: [],
    };
    Object.defineProperty(input, 'activationClaims', {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? claims : 'not-an-array';
      },
    });
    const report = evaluateProdConformance(input as never);
    expect(reads).toBe(1);
    expect(report.overall).toBe('FAILED');
    expect(
      report.findings.some((finding) => finding.rule === PROD_RULES.activationWithoutEvidence),
    ).toBe(true);
  }, 120_000);
});

/**
 * M1 (fifth-round convergence audit). The release-gate finding MESSAGES were
 * still built with `Array.prototype.join`; a `join` shadow returning a
 * non-string made the message template throw, turning a clean FAILED verdict
 * into an uncaught exception. The decision must stay total: FAILED, no throw.
 */
describe('M1: release-gate finding messages survive a join shadow', () => {
  it('still returns FAILED (no throw) when Array.prototype.join is shadowed to a non-string', () => {
    const proto = Array.prototype as unknown as Record<string, unknown>;
    const originalJoin = proto['join'];
    proto['join'] = function (this: unknown): unknown {
      return this;
    };
    let result: { readonly overall?: string } | undefined;
    let error: unknown = null;
    try {
      result = evaluateProdConformance({
        activationClaims: [],
        postureDeclarations: [],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [PROD_LIVE_PATH_NO_BOUND_CLAIM],
        distributionAuthorizations: [PROD_PUBLIC_AUTHORIZED_MISSING_CLAIM],
      }) as { readonly overall?: string };
    } catch (thrown) {
      error = thrown;
    } finally {
      proto['join'] = originalJoin;
    }
    expect(error).toBeNull();
    expect(result?.overall).toBe('FAILED');
  }, 120_000);
});

/**
 * Seventh-round emergency correction (V7-C1/N3, V7-NF2, V7-NF3). Each test is a
 * discriminating regression: it was verified to FAIL against the frozen base
 * `27c12c8` and PASS after the bounded fix.
 */
describe('V7: release-gate totality, PROD-claim reachability and superseded defaults', () => {
  it('never throws on malformed/sparse claim elements and fails the report closed (V7-NF2)', () => {
    const cases: readonly Record<string, unknown>[] = [
      { postureDeclarations: [undefined] },
      { livePaths: [undefined] },
      { mcpCompatibility: { ...PROD_MCP_COMPLIANT_CLAIM, revisions: [undefined] } },
      { mcpCompatibility: { ...PROD_MCP_COMPLIANT_CLAIM, clients: [undefined] } },
      { mcpCompatibility: { ...PROD_MCP_COMPLIANT_CLAIM, cells: [undefined] } },
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const input = cases[index] as Record<string, unknown>;
      let report: { readonly overall?: string } | undefined;
      let error: unknown = null;
      try {
        report = evaluateProdConformance(input as Parameters<typeof evaluateProdConformance>[0]);
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toBeNull();
      expect(report?.overall).toBe('FAILED');
    }
  }, 120_000);

  it('refuses a superseded STABLE revision as the compatibility default (V7-NF3)', () => {
    const base = PROD_MCP_COMPLIANT_CLAIM.revisions[0];
    expect(base).toBeDefined();
    const superseded: typeof PROD_MCP_COMPLIANT_CLAIM = {
      ...PROD_MCP_COMPLIANT_CLAIM,
      revisions: PROD_MCP_COMPLIANT_CLAIM.revisions.map((row, index) =>
        index === 0 ? { ...row, supersededBy: '2025-12-01' } : row,
      ),
    };
    const report = checkMcpCompatibilityDrift(superseded);
    expect(report.passed).toBe(false);
    expect(report.findings.some((finding) => finding.message.includes('superseded'))).toBe(true);
    // The unmodified compliant claim still passes (no over-refusal control).
    expect(checkMcpCompatibilityDrift(PROD_MCP_COMPLIANT_CLAIM).passed).toBe(true);
  }, 120_000);

  it('evaluates supplied PROD claims even for a milestone that owns no FR-PROD law (V7-C1/N3)', async () => {
    const result = await evaluateConformance({
      repoRoot: REPO_ROOT,
      milestone: 'G0',
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
  }, 120_000);
});
