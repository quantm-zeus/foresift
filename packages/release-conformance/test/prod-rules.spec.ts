/**
 * PROD release-conformance rule suite (T032, FR-PROD-001…006, AC-144/152/
 * 272/273/275/276/277/278/279).
 *
 * Every PROD rule must detect its violation and accept compliant input, and the
 * four pre-existing trace rules must keep passing unchanged.
 */
import { describe, expect, it } from 'bun:test';
import {
  CONFORMANCE_RULES,
  PROD_RULES,
  checkActivationWithoutEvidence,
  checkLivePathPrecomputationViolation,
  checkMcpCompatibilityDrift,
  checkPostureWeakening,
  checkPublicAuthorizationWithoutGateEvidence,
  evaluateDistributionAuthorization,
  evaluateProdConformance,
} from '../src/index.ts';
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
    for (const rule of Object.values(PROD_RULES)) {
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

  it('keeps the four pre-existing trace rules present and unchanged', () => {
    expect(CONFORMANCE_RULES).toEqual({
      mapping: 'NORMATIVE_MAPPING_COMPLETE',
      activePath: 'ACTIVE_IMPLEMENTATION_PATH_EXISTS',
      premature: 'DEPENDENCY_GATE_NOT_OPEN',
      generated: 'GENERATED_DOCUMENT_DRIFT',
    });
  });

  it('runs the repository-backed trace rules without PROD interference', async () => {
    const { evaluateConformance } = await import('../src/index.ts');
    const result = await evaluateConformance({ repoRoot: REPO_ROOT });
    expect(['PASSED', 'FAILED']).toContain(result.overall);
    for (const finding of result.findings) {
      expect(finding.rule).not.toBe(PROD_RULES.activationWithoutEvidence);
      expect(finding.rule).not.toBe(PROD_RULES.postureWeakening);
    }
  });
});
