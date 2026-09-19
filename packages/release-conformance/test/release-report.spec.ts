/**
 * Unit suite for SBOM projection and release report builder / verifier (FR-TRACE-006 / AC-269).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- salvaged lane tests: mock objects cast against a runtime-typed surface (see tests/automation/state-authority-v2.spec.ts convention) */
import { describe, expect, it } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateConformance,
  generateSbomFromLockfile,
  buildReleaseReport,
  verifyReleaseReport,
} from '../src/index.ts';
import {
  VALID_RELEASE_REPORT_FIXTURE,
  VALID_SBOM_FIXTURE as _VALID_SBOM_FIXTURE,
} from '../../../tests/fixtures/trace/index.ts';
import {
  PROD_BEST_EFFORT_COMPLIANT,
  PROD_COMPLIANT_ACTIVE_CLAIM,
  PROD_LIVE_PATH_BOUNDED_CLAIM,
  PROD_MCP_COMPLIANT_CLAIM,
  PROD_TECHNICALLY_READY_CLAIM,
  PROD_WORKSPACE_AUTHORIZED_CLAIM,
} from '../../../tests/fixtures/prod/index.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LOCKFILE_PATH = path.join(REPO_ROOT, 'pnpm-lock.yaml');

let cachedGeneratedSnapshot: Record<string, Uint8Array> | undefined;
async function generatedSnapshot(): Promise<Record<string, Uint8Array>> {
  if (cachedGeneratedSnapshot !== undefined) return cachedGeneratedSnapshot;
  const generatedRoot = path.join(REPO_ROOT, 'docs/generated');
  const snapshot: Record<string, Uint8Array> = {};
  const visit = async (relative: string): Promise<void> => {
    const entries = await readdir(path.join(generatedRoot, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) snapshot[child] = await readFile(path.join(generatedRoot, child));
    }
  };
  await visit('');
  cachedGeneratedSnapshot = snapshot;
  return snapshot;
}

/**
 * A REAL branded `evaluateConformance` result over a fully compliant PROD
 * corpus. Only `evaluateConformance` can mint the provenance brand, so this is
 * the sole way to obtain a conformance result that `buildReleaseReport` will
 * admit to `ACTIVE`.
 */
async function realConformanceResult() {
  return await evaluateConformance({
    repoRoot: REPO_ROOT,
    requirements: [],
    expectedGeneratedFiles: await generatedSnapshot(),
    prodClaims: {
      activationClaims: [PROD_COMPLIANT_ACTIVE_CLAIM],
      postureDeclarations: [PROD_BEST_EFFORT_COMPLIANT],
      mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
      livePaths: [PROD_LIVE_PATH_BOUNDED_CLAIM],
      distributionAuthorizations: [PROD_WORKSPACE_AUTHORIZED_CLAIM, PROD_TECHNICALLY_READY_CLAIM],
    },
  });
}

describe('SBOM projection and release report builder (FR-TRACE-006, AC-269)', () => {
  describe('deterministic CycloneDX SBOM projection', () => {
    it('projects pnpm-lock.yaml into a deterministic CycloneDX SBOM', async () => {
      const sbom = await generateSbomFromLockfile(LOCKFILE_PATH);
      expect(sbom).toBeDefined();
      expect(sbom.bomFormat).toBe('CycloneDX');
      expect(sbom.components.length).toBeGreaterThan(0);
      expect(sbom.inventoryHash).toBeDefined();
      expect(sbom.inventoryHash.length).toBe(64);
    });

    it('produces byte-identical SBOM outputs on repeated invocations (no timestamps)', async () => {
      const run1 = await generateSbomFromLockfile(LOCKFILE_PATH);
      const run2 = await generateSbomFromLockfile(LOCKFILE_PATH);

      expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
      expect(run1.inventoryHash).toBe(run2.inventoryHash);
    });
  });

  describe('release report builder and verification', () => {
    it('builds a complete ReleaseReportRecord covering all FR-TRACE-006 fields', async () => {
      const report = await buildReleaseReport({
        repoRoot: REPO_ROOT,
        milestone: 'G0',
        previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
      });

      expect(report).toBeDefined();
      expect(report.reportId).toBeDefined();
      expect(report.documentHash).toBeDefined();
      expect(report.manifestHash).toBeDefined();
      expect(report.normalizedHash).toBeDefined();
      expect(report.dependencySbomHash).toBeDefined();
      expect(report.migrationHashes).toBeDefined();
      expect(report.schemaHashes).toBeDefined();
      expect(report.conformanceResults).toBeDefined();
      expect(report.activationState).toBeDefined();
      expect(report.rollbackTarget).toBeDefined();
    });

    it('verifies a valid release report successfully', () => {
      const verification = verifyReleaseReport(VALID_RELEASE_REPORT_FIXTURE);
      expect(verification.isValid).toBe(true);
      expect(verification.errors).toEqual([]);
    });

    it('refuses a report with missing fields (e.g. missing manifestHash)', () => {
      const incomplete = {
        ...VALID_RELEASE_REPORT_FIXTURE,
        manifestHash: undefined,
      };

      const verification = verifyReleaseReport(incomplete as any);
      expect(verification.isValid).toBe(false);
      expect(verification.errors.some((e: string) => e.includes('manifestHash'))).toBe(true);
    });

    it('refuses a report with hash disagreement or tampering', () => {
      const tampered = {
        ...VALID_RELEASE_REPORT_FIXTURE,
        documentHash: '0000000000000000000000000000000000000000000000000000000000000000',
      };

      const verification = verifyReleaseReport(tampered);
      expect(verification.isValid).toBe(false);
      expect(verification.errors.length).toBeGreaterThan(0);
    });
  });
});

/**
 * V7-F7: an omitted conformance result must not be recorded as PASSED. Before
 * this, `buildReleaseReport` defaulted to `overall: 'PASSED'` with zero rules
 * evaluated, and one valid gate-evidence item drove `activationState.status`
 * to `ACTIVE` — a release report that certified a gate it never ran.
 */
describe('V7: release report refuses to certify unevaluated conformance (F7)', () => {
  it('records FAILED (not PASSED) when no conformance result was supplied', async () => {
    const report = await buildReleaseReport({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
    });
    expect(report.conformanceResults.overall).toBe('FAILED');
    expect(report.conformanceResults.totalRulesEvaluated).toBe(1);
    expect(report.conformanceResults.failureCount).toBe(1);
    expect(
      report.conformanceResults.findings.some(
        (finding) => finding.rule === 'CONFORMANCE_NOT_EVALUATED',
      ),
    ).toBe(true);
    expect(report.activationState.status).not.toBe('ACTIVE');
    // Pin the record-schema balance invariant directly (V7 review note): the
    // synthetic 1/0/1 counts must keep `verifyReleaseReport` valid.
    expect(verifyReleaseReport(report).isValid).toBe(true);

    // Control: a REAL, branded `evaluateConformance` result is admitted. The
    // live tree has no PROD claims, so this real result is FAILED, but its
    // findings are the gate's own (never CONFORMANCE_UNVERIFIED).
    const real = await evaluateConformance({ repoRoot: REPO_ROOT });
    const evaluated = await buildReleaseReport({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
      conformanceResults: real,
    });
    expect(evaluated.conformanceResults.overall).toBe('FAILED');
    expect(evaluated.conformanceResults.totalRulesEvaluated).toBeGreaterThan(0);
    expect(
      evaluated.conformanceResults.findings.some(
        (finding) => finding.rule === 'CONFORMANCE_UNVERIFIED',
      ),
    ).toBe(false);
  }, 120_000);
});

/**
 * V7-F7b fail-open: `buildReleaseReport` trusted a CALLER-SUPPLIED conformance
 * result verbatim. Supplying `{overall:'PASSED', totalRulesEvaluated:0, …}` with
 * one valid gate-evidence item returned `status:'ACTIVE'` and
 * `verifyReleaseReport` accepted it, contradicting the invariant stated in the
 * builder ("a release report cannot record PASSED with zero evaluated rules").
 */
describe('V7: release report validates a SUPPLIED conformance result (F7b)', () => {
  const VALID_GATE_EVIDENCE = [
    { gateKind: 'CONFORMANCE', evidenceId: 'gate-1', isValid: true, reason: 'passed' },
  ] as const;

  it('(a) rejects a supplied vacuous PASSED and blocks activation', async () => {
    const report = await buildReleaseReport({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
      conformanceResults: {
        overall: 'PASSED',
        totalRulesEvaluated: 0,
        passedCount: 0,
        failureCount: 0,
        findings: [],
      },
      gateEvidence: [...VALID_GATE_EVIDENCE],
    });
    expect(report.activationState.status).toBe('BLOCKED');
    expect(report.conformanceResults.overall).toBe('FAILED');
    expect(
      report.conformanceResults.findings.some(
        (finding) => finding.rule === 'CONFORMANCE_UNVERIFIED',
      ),
    ).toBe(true);
  }, 120_000);

  it('(b) verifyReleaseReport rejects a PASSED report with zero evaluated rules', () => {
    const vacuous = {
      ...VALID_RELEASE_REPORT_FIXTURE,
      conformanceResults: {
        overall: 'PASSED',
        totalRulesEvaluated: 0,
        passedCount: 0,
        failureCount: 0,
        findings: [],
      },
      activationState: { ...VALID_RELEASE_REPORT_FIXTURE.activationState, status: 'ACTIVE' },
    };
    const verification = verifyReleaseReport(vacuous as any);
    expect(verification.isValid).toBe(false);
    expect(
      verification.errors.some(
        (error: string) => error.includes('PASSED') && error.includes('zero rules'),
      ),
    ).toBe(true);
  });

  it('(c) refuses a hand-built self-consistent PASSED (HIGH-3)', async () => {
    const report = await buildReleaseReport({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
      conformanceResults: {
        overall: 'PASSED',
        totalRulesEvaluated: 42,
        passedCount: 42,
        failureCount: 0,
        findings: [],
      },
      gateEvidence: [...VALID_GATE_EVIDENCE],
    });
    expect(report.conformanceResults.overall).toBe('FAILED');
    expect(report.activationState.status).toBe('BLOCKED');
    expect(
      report.conformanceResults.findings.some(
        (finding) => finding.rule === 'CONFORMANCE_UNVERIFIED',
      ),
    ).toBe(true);
  }, 120_000);

  it('(c2) refuses a structurally-cloned copy of a real result (HIGH-3)', async () => {
    const real = await realConformanceResult();
    expect(real.overall).toBe('PASSED');
    const clone = structuredClone(real);
    const report = await buildReleaseReport({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
      conformanceResults: clone as never,
      gateEvidence: [...VALID_GATE_EVIDENCE],
    });
    expect(report.conformanceResults.overall).toBe('FAILED');
    expect(report.activationState.status).toBe('BLOCKED');
    expect(
      report.conformanceResults.findings.some(
        (finding) => finding.rule === 'CONFORMANCE_UNVERIFIED',
      ),
    ).toBe(true);
  }, 120_000);

  it('(c3) CONTROL: a real evaluateConformance result is admitted and activates (HIGH-3)', async () => {
    const real = await realConformanceResult();
    expect(real.overall).toBe('PASSED');
    const report = await buildReleaseReport({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
      conformanceResults: real,
      gateEvidence: [...VALID_GATE_EVIDENCE],
    });
    expect(report.conformanceResults.overall).toBe('PASSED');
    expect(report.activationState.status).toBe('ACTIVE');
    expect(
      report.conformanceResults.findings.some(
        (finding) => finding.rule === 'CONFORMANCE_UNVERIFIED',
      ),
    ).toBe(false);
  }, 120_000);

  it('(d) fails closed on a malformed supplied result (never throws)', async () => {
    for (const malformed of [[], null, 'PASSED', 7]) {
      const report = await buildReleaseReport({
        repoRoot: REPO_ROOT,
        milestone: 'G2',
        previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
        conformanceResults: malformed as never,
        gateEvidence: [...VALID_GATE_EVIDENCE],
      });
      expect(report.conformanceResults.overall).toBe('FAILED');
      expect(report.activationState.status).toBe('BLOCKED');
      expect(
        report.conformanceResults.findings.some(
          (finding) => finding.rule === 'CONFORMANCE_UNVERIFIED',
        ),
      ).toBe(true);
    }
  }, 120_000);

  it('(e) hardening: a getter carrier is neutralized by the entry snapshot', async () => {
    let reads = 0;
    const carrier: Record<string, unknown> = {};
    Object.defineProperty(carrier, 'findings', { enumerable: true, get: () => [] });
    Object.defineProperty(carrier, 'failureCount', { enumerable: true, get: () => 1 });
    Object.defineProperty(carrier, 'passedCount', { enumerable: true, get: () => 0 });
    Object.defineProperty(carrier, 'totalRulesEvaluated', { enumerable: true, get: () => 1 });
    Object.defineProperty(carrier, 'overall', {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? 'FAILED' : 'PASSED';
      },
    });
    const report = await buildReleaseReport({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
      conformanceResults: carrier as never,
      gateEvidence: [...VALID_GATE_EVIDENCE],
    });
    // The entry `snapshotCallerInput` read the carrier exactly once, so the
    // value validated is the value consumed: never the later 'PASSED'.
    expect(reads).toBe(1);
    expect(report.conformanceResults.overall).toBe('FAILED');
    expect(report.activationState.status).not.toBe('ACTIVE');
  }, 120_000);

  it('(f) refuses a non-plain conformanceResults carrier (never PASSED/ACTIVE)', async () => {
    class ConformanceCarrier {
      readonly overall = 'PASSED';
      readonly totalRulesEvaluated = 1;
      readonly passedCount = 1;
      readonly failureCount = 0;
      readonly findings: readonly unknown[] = [];
    }
    await expect(
      buildReleaseReport({
        repoRoot: REPO_ROOT,
        milestone: 'G2',
        previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
        conformanceResults: new ConformanceCarrier() as never,
        gateEvidence: [...VALID_GATE_EVIDENCE],
      }),
    ).rejects.toThrow(/non-plain caller input/);
  }, 120_000);

  it('(g) refuses a non-plain top-level options carrier (never PASSED/ACTIVE)', async () => {
    class OptionsCarrier {
      readonly repoRoot = REPO_ROOT;
      readonly milestone = 'G2';
      readonly previousReport = VALID_RELEASE_REPORT_FIXTURE.rollbackTarget;
      readonly gateEvidence = [...VALID_GATE_EVIDENCE];
    }
    await expect(buildReleaseReport(new OptionsCarrier() as never)).rejects.toThrow(
      /non-plain caller input/,
    );
  }, 120_000);
});
