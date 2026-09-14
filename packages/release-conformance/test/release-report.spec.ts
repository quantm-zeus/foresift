/**
 * Unit suite for SBOM projection and release report builder / verifier (FR-TRACE-006 / AC-269).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- salvaged lane tests: mock objects cast against a runtime-typed surface (see tests/automation/state-authority-v2.spec.ts convention) */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSbomFromLockfile, buildReleaseReport, verifyReleaseReport } from '../src/index.ts';
import {
  VALID_RELEASE_REPORT_FIXTURE,
  VALID_SBOM_FIXTURE as _VALID_SBOM_FIXTURE,
} from '../../../tests/fixtures/trace/index.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LOCKFILE_PATH = path.join(REPO_ROOT, 'pnpm-lock.yaml');

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

    // Control: a genuinely evaluated conformance result is recorded verbatim.
    const evaluated = await buildReleaseReport({
      repoRoot: REPO_ROOT,
      milestone: 'G2',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
      conformanceResults: {
        overall: 'FAILED',
        totalRulesEvaluated: 9,
        passedCount: 8,
        failureCount: 1,
        findings: [
          {
            requirementId: 'FR-PROD-001',
            rule: 'ACTIVATION_WITHOUT_EVIDENCE',
            path: 'module-x',
            message: 'evaluated',
          },
        ],
      },
    });
    expect(evaluated.conformanceResults.overall).toBe('FAILED');
    expect(evaluated.conformanceResults.totalRulesEvaluated).toBe(9);
    expect(
      evaluated.conformanceResults.findings.some(
        (finding) => finding.rule === 'CONFORMANCE_NOT_EVALUATED',
      ),
    ).toBe(false);
  }, 120_000);
});
