/**
 * Unit suite for requirement manifest query and mapping resolver (FR-TRACE-001 / AC-265).
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import { loadRequirementManifest, queryByFamily, queryByDependencyGroup, queryByOwner, queryByStatus, queryRequirementsByAc, resolveMappings } from '../src/index.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
);

describe('requirement manifest query and mapping resolution (FR-TRACE-001, AC-265)', () => {
  let manifest: any;

  it('loads the manifest for query tests', async () => {
    manifest = await loadRequirementManifest({ manifestPath: MANIFEST_PATH });
    expect(manifest).toBeDefined();
  });

  describe('queries by family', () => {
    it('returns all 6 FR-TRACE requirements when querying FR-TRACE family', () => {
      const results = queryByFamily(manifest, 'FR-TRACE');
      expect(results).toHaveLength(6);
      expect(results.map((r: any) => r.id)).toEqual([
        'FR-TRACE-001',
        'FR-TRACE-002',
        'FR-TRACE-003',
        'FR-TRACE-004',
        'FR-TRACE-005',
        'FR-TRACE-006',
      ]);
    });

    it('returns empty array for unknown family', () => {
      const results = queryByFamily(manifest, 'FR-UNKNOWN');
      expect(results).toEqual([]);
    });
  });

  describe('queries by dependency group', () => {
    it('returns all requirements assigned to G0 milestone', () => {
      const results = queryByDependencyGroup(manifest, 'G0');
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.dependencyGroup).toBe('G0');
      }
      expect(results.some((r: any) => r.id === 'FR-TRACE-001')).toBe(true);
    });
  });

  describe('queries by owner', () => {
    it('returns requirements owned by packages/requirement-manifest', () => {
      const results = queryByOwner(manifest, 'packages/requirement-manifest');
      expect(results.length).toBeGreaterThanOrEqual(6);
      expect(results.map((r: any) => r.id)).toContain('FR-TRACE-001');
    });
  });

  describe('queries by status', () => {
    it('filters requirements by status', () => {
      const results = queryByStatus(manifest, 'NOT_IMPLEMENTED');
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.status).toBe('NOT_IMPLEMENTED');
      }
    });
  });

  describe('AC reverse lookup', () => {
    it('finds all requirements linked to AC-265', () => {
      const results = queryRequirementsByAc(manifest, 'AC-265');
      expect(results).toHaveLength(6);
      expect(results.map((r: any) => r.id)).toEqual([
        'FR-TRACE-001',
        'FR-TRACE-002',
        'FR-TRACE-003',
        'FR-TRACE-004',
        'FR-TRACE-005',
        'FR-TRACE-006',
      ]);
    });

    it('finds requirements linked to AC-001', () => {
      const results = queryRequirementsByAc(manifest, 'AC-001');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r: any) => r.id === 'FR-CORE-001')).toBe(true);
    });
  });

  describe('mapping resolution', () => {
    it('resolves implementationRefs, schemaRefs, persistenceRefs, apiToolUiRefs, telemetryRefs, and fixtureRefs', () => {
      const mappings = resolveMappings(manifest, 'FR-TRACE-001');
      expect(mappings).toBeDefined();
      expect(mappings.implementationRefs).toContain(
        'packages/requirement-manifest/** @requirement FR-TRACE-001',
      );
      expect(mappings.schemaRefs).toContain('packages/shared-schemas/src/trace.ts');
      expect(mappings.persistenceRefs).toContain('migrations/g0_trace_*.sql');
      expect(mappings.apiToolUiRefs).toContain('docs/generated/trace-surfaces.json');
      expect(mappings.telemetryRefs).toContain('telemetry/trace.*');
      expect(mappings.fixtureRefs).toContain('tests/fixtures/trace/');
    });
  });
});
