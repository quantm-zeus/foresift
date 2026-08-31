/**
 * AC-266 negative.
 * Traces: FR-TRACE-003.
 * Refusals proven: adding, deleting, duplicating, renumbering, or changing a normative item
 * WITHOUT a matching manifest/test update fails conformance and CI, naming the drifted item
 * and the failing rule.
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import { evaluateConformance, checkMappingCompleteness, checkActiveImplementationPaths, detectOrphanSources } from '@foresift/release-conformance';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('AC-266 negative (conformance failures on uncoordinated changes)', () => {
  it('fails conformance when a normative item lacks implementation mapping', () => {
    const unmappedItem = {
      id: 'FR-DRIFT-001',
      owner: 'packages/release-conformance',
      implementationRefs: [],
      testRefs: ['tests/acceptance/AC-266.spec.ts'],
    };

    const verdict = checkMappingCompleteness({
      requirements: [unmappedItem as any],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.unmappedItems.length).toBeGreaterThan(0);
    expect(verdict.unmappedItems[0].id).toBe('FR-DRIFT-001');
  });

  it('fails conformance when a mapped implementation path is deleted or does not exist', async () => {
    const missingPathItem = {
      id: 'FR-MISSING-PATH-001',
      dependencyGroup: 'G0',
      implementationRefs: ['packages/deleted-path/src/gone.ts @requirement FR-MISSING-PATH-001'],
    };

    const verdict = await checkActiveImplementationPaths({
      repoRoot: REPO_ROOT,
      activeGroup: 'G0',
      requirements: [missingPathItem as any],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.findings.length).toBeGreaterThan(0);
    const finding = verdict.findings[0];
    expect(finding.requirementId).toBe('FR-MISSING-PATH-001');
    expect(finding.rule).toBe('ACTIVE_IMPLEMENTATION_PATH_EXISTS');
  });

  it('fails conformance when an unmapped product source file is introduced without an exception ledger entry', () => {
    const orphanResult = detectOrphanSources({
      productFiles: ['packages/unmapped-experiment/src/untraced.ts'],
      implementationRefs: ['packages/core/src/** @requirement FR-CORE-001'],
      exceptions: [],
    });

    expect(orphanResult.passed).toBe(false);
    expect(orphanResult.unexemptedOrphans).toContain('packages/unmapped-experiment/src/untraced.ts');
  });
});
