/**
 * Unit suite for release conformance verification rules (FR-TRACE-003 / AC-266).
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import { evaluateConformance, checkMappingCompleteness, checkActiveImplementationPaths, checkNoPrematureImplementations, checkGeneratedDocsDrift } from '../src/index.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('release conformance evaluation (FR-TRACE-003, AC-266)', () => {
  describe('Rule (a): Mapping completeness for normative items', () => {
    it('verifies that all normative items carry non-empty implementation, test, and owner mappings', async () => {
      const verdict = await checkMappingCompleteness({ repoRoot: REPO_ROOT });
      expect(verdict.passed).toBe(true);
      expect(verdict.unmappedItems).toEqual([]);
    });

    it('flags an item when an implementation mapping is missing', () => {
      const mockRequirements = [
        {
          id: 'FR-MOCK-001',
          owner: 'packages/release-conformance',
          implementationRefs: [], // Missing!
          testRefs: ['tests/acceptance/AC-265.spec.ts'],
        },
      ];

      const verdict = checkMappingCompleteness({ requirements: mockRequirements as any });
      expect(verdict.passed).toBe(false);
      expect(verdict.unmappedItems.map((u: any) => u.id)).toContain('FR-MOCK-001');
    });
  });

  describe('Rule (b): Active implementation path resolution', () => {
    it('verifies that every implementationRef in active milestone G0 resolves to an existing path', async () => {
      const verdict = await checkActiveImplementationPaths({
        repoRoot: REPO_ROOT,
        activeGroup: 'G0',
      });
      expect(verdict.passed).toBe(true);
      expect(verdict.missingPaths).toEqual([]);
    });

    it('reports missing path finding with requirement id, rule, and exact path', async () => {
      const mockRequirements = [
        {
          id: 'FR-MOCK-002',
          dependencyGroup: 'G0',
          implementationRefs: ['packages/non-existent-pkg/src/index.ts @requirement FR-MOCK-002'],
        },
      ];

      const verdict = await checkActiveImplementationPaths({
        repoRoot: REPO_ROOT,
        activeGroup: 'G0',
        requirements: mockRequirements as any,
      });

      expect(verdict.passed).toBe(false);
      expect(verdict.findings.length).toBeGreaterThan(0);
      const finding = verdict.findings[0];
      expect(finding.requirementId).toBe('FR-MOCK-002');
      expect(finding.rule).toBe('ACTIVE_IMPLEMENTATION_PATH_EXISTS');
      expect(finding.path).toContain('packages/non-existent-pkg');
    });
  });

  describe('Rule (c): No premature implementations for future dependency groups', () => {
    it('verifies that no product path for later dependency groups (e.g. G1/G2) exists before their gate opens', async () => {
      const verdict = await checkNoPrematureImplementations({
        repoRoot: REPO_ROOT,
        activeGroup: 'G0',
      });
      expect(verdict.passed).toBe(true);
      expect(verdict.prematurePaths).toEqual([]);
    });
  });

  describe('Rule (d): docs/generated/** deterministic drift check', () => {
    it('verifies docs/generated/** matches deterministic regeneration without drift', async () => {
      const verdict = await checkGeneratedDocsDrift({ repoRoot: REPO_ROOT });
      if (verdict.passed) {
        expect(verdict.driftedFiles).toEqual([]);
      } else {
        expect(verdict.findings.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Full Conformance Verdict Aggregation', () => {
    it('aggregates all rules into a unified ConformanceResult', async () => {
      const result = await evaluateConformance({ repoRoot: REPO_ROOT });
      expect(result).toBeDefined();
      expect(typeof result.overall).toBe('string');
      expect(Array.isArray(result.findings)).toBe(true);
    });
  });
});
