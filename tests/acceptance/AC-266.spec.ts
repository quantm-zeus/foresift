/**
 * AC-266 acceptance (positive).
 * Traces: FR-TRACE-003.
 * AC text (manifest §39.25): "Adding, deleting, duplicating, renumbering, or changing a
 * normative item without a matching manifest/test update fails CI."
 *
 * Positive path: adding/changing an item WITH matching manifest and test mappings passes
 * release conformance verification completely.
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import { evaluateConformance } from '@foresift/release-conformance';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('AC-266 acceptance (positive)', () => {
  it('passes release conformance when all normative items and code paths match perfectly', async () => {
    const verdict = await evaluateConformance({
      repoRoot: REPO_ROOT,
      milestone: 'G0',
    });

    expect(verdict).toBeDefined();
    expect(verdict.overall).toBe('PASSED');
    expect(verdict.findings).toEqual([]);
  });
});
