/**
 * Unit suite for SBOM projection and release report builder / verifier (FR-TRACE-006 / AC-269).
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import { generateSbomFromLockfile, buildReleaseReport, verifyReleaseReport } from '../src/index.ts';
import {
  VALID_RELEASE_REPORT_FIXTURE,
  VALID_SBOM_FIXTURE,
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
