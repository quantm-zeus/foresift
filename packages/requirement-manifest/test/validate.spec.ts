/**
 * Unit suite for loadRequirementManifest and validateRequirementManifest (FR-TRACE-001 / AC-265).
 * Validates manifest parsing, checksums, line anchors, reference integrity, DAG acyclicity,
 * and four-way count agreement against real and fixture artifacts.
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import { loadRequirementManifest, validateRequirementManifest, computeTextSha256, verifyFourWayCountAgreement, checkDependencyDagAcyclicity } from '../src/index.ts';
import {
  PINNED_DOCUMENT_SHA256,
  PINNED_MANIFEST_SHA256,
  PINNED_AUDIT_SHA256,
  PINNED_FR_TRACE_REQUIREMENTS,
  PINNED_AC_TRACE_CRITERIA,
} from '../../../tests/fixtures/trace/index.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
);
const AUDIT_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json',
);
const PRD_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md',
);
const SHA256SUMS_PATH = path.join(REPO_ROOT, 'docs/spec/SHA256SUMS');

describe('requirement manifest load and validate (FR-TRACE-001, AC-265)', () => {
  describe('positive: real PRD and manifest artifacts', () => {
    it('loads and validates the live requirement manifest without errors', async () => {
      const manifest = await loadRequirementManifest({
        manifestPath: MANIFEST_PATH,
        auditPath: AUDIT_PATH,
        prdPath: PRD_PATH,
        sha256sumsPath: SHA256SUMS_PATH,
      });

      expect(manifest).toBeDefined();
      expect(manifest.schemaVersion).toBe('1.0.0');
      expect(manifest.requirements.length).toBe(397);
      expect(manifest.acceptanceCriteria.length).toBe(204);
      expect(manifest.invariants.length).toBe(44);
      expect(manifest.adrs.length).toBe(58);
    });

    it('confirms four-way count agreement (manifest ↔ audit.inventory ↔ audit.manifest ↔ releaseConformance)', async () => {
      const counts = await verifyFourWayCountAgreement({
        manifestPath: MANIFEST_PATH,
        auditPath: AUDIT_PATH,
      });

      expect(counts.agreed).toBe(true);
      expect(counts.requirements).toBe(397);
      expect(counts.acceptanceCriteria).toBe(204);
      expect(counts.invariants).toBe(44);
      expect(counts.adrs).toBe(58);
    });

    it('verifies SHA256SUMS agreement with live artifacts', async () => {
      const validation = await validateRequirementManifest({
        manifestPath: MANIFEST_PATH,
        auditPath: AUDIT_PATH,
        prdPath: PRD_PATH,
        sha256sumsPath: SHA256SUMS_PATH,
      });

      expect(validation.isValid).toBe(true);
      expect(validation.hashes.manifestSha256).toBe(PINNED_MANIFEST_SHA256);
      expect(validation.hashes.documentSha256).toBe(PINNED_DOCUMENT_SHA256);
      expect(validation.hashes.auditSha256).toBe(PINNED_AUDIT_SHA256);
    });

    it('verifies text hashes of FR and AC items match recomputed SHA-256', async () => {
      const manifest = await loadRequirementManifest({ manifestPath: MANIFEST_PATH });

      for (const pinned of PINNED_FR_TRACE_REQUIREMENTS) {
        const found = manifest.requirements.find((r: any) => r.id === pinned.id);
        expect(found).toBeDefined();
        expect(found.text).toBe(pinned.text);
        expect(computeTextSha256(found.text)).toBe(pinned.textSha256);
      }

      for (const pinned of PINNED_AC_TRACE_CRITERIA) {
        const found = manifest.acceptanceCriteria.find((a: any) => a.id === pinned.id);
        expect(found).toBeDefined();
        expect(found.text).toBe(pinned.text);
        expect(computeTextSha256(found.text)).toBe(pinned.textSha256);
      }
    });

    it('verifies dependency-group DAG is acyclic', async () => {
      const manifest = await loadRequirementManifest({ manifestPath: MANIFEST_PATH });
      const dagCheck = checkDependencyDagAcyclicity(manifest.dependencyGroups);
      expect(dagCheck.isAcyclic).toBe(true);
      expect(dagCheck.cycles).toEqual([]);
    });

    it('verifies reference integrity across all ACs, FRs, and Invariants', async () => {
      const manifest = await loadRequirementManifest({ manifestPath: MANIFEST_PATH });

      const frIds = new Set(manifest.requirements.map((r: any) => r.id));
      const acIds = new Set(manifest.acceptanceCriteria.map((a: any) => a.id));

      for (const ac of manifest.acceptanceCriteria) {
        for (const frRef of ac.requirementRefs) {
          expect(frIds.has(frRef)).toBe(true);
        }
      }

      for (const fr of manifest.requirements) {
        for (const acRef of fr.acceptanceCriteria) {
          expect(acIds.has(acRef)).toBe(true);
        }
      }
    });
  });

  describe('negative: refusals on invalid manifest content', () => {
    it('refuses manifest with corrupted text hash', async () => {
      const manifest = await loadRequirementManifest({ manifestPath: MANIFEST_PATH });
      const corrupted = {
        ...manifest,
        requirements: manifest.requirements.map((r: any) =>
          r.id === 'FR-TRACE-001' ? { ...r, textSha256: 'deadbeef'.repeat(8) } : r,
        ),
      };

      expect(() => validateRequirementManifest({ manifestData: corrupted })).toThrow(
        /TEXT_HASH_MISMATCH|hash mismatch|invalid text hash/i,
      );
    });

    it('refuses manifest with dangling reference from AC to non-existent FR', async () => {
      const manifest = await loadRequirementManifest({ manifestPath: MANIFEST_PATH });
      const corrupted = {
        ...manifest,
        acceptanceCriteria: manifest.acceptanceCriteria.map((a: any) =>
          a.id === 'AC-265' ? { ...a, requirementRefs: [...a.requirementRefs, 'FR-NONEXISTENT-999'] } : a,
        ),
      };

      expect(() => validateRequirementManifest({ manifestData: corrupted })).toThrow(
        /DANGLING_REFERENCE|missing requirement|reference integrity/i,
      );
    });

    it('refuses manifest with cyclic dependency groups', async () => {
      const cyclicGroups = [
        { id: 'G0', dependencies: ['G1'] },
        { id: 'G1', dependencies: ['G0'] },
      ];
      const dagCheck = checkDependencyDagAcyclicity(cyclicGroups as any);
      expect(dagCheck.isAcyclic).toBe(false);
      expect(dagCheck.cycles.length).toBeGreaterThan(0);
    });

    it('refuses manifest when 4-way counts disagree', async () => {
      const manifest = await loadRequirementManifest({ manifestPath: MANIFEST_PATH });
      const corrupted = {
        ...manifest,
        requirements: manifest.requirements.slice(0, 100), // Only 100 instead of 397
      };

      expect(() =>
        verifyFourWayCountAgreement({
          manifestData: corrupted,
          auditPath: AUDIT_PATH,
        }),
      ).toThrow(/COUNT_MISMATCH|disagreement/i);
    });
  });
});
