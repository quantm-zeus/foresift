/**
 * AC-266 acceptance (positive).
 * Traces: FR-TRACE-003.
 * AC text (manifest §39.25): "Adding, deleting, duplicating, renumbering, or changing a
 * normative item without a matching manifest/test update fails CI."
 *
 * Positive path: adding/changing an item WITH matching manifest and test mappings passes
 * release conformance verification completely.
 *
 * The aggregate gate is evaluated against a CONFORMANT CORPUS (a normative item whose
 * implementation and test mappings both resolve, plus a fully compliant PROD governance
 * claim set) rather than the live mid-flight milestone. Two properties are asserted by
 * construction:
 *
 *  - the caller may NOT pin the evaluation to a milestone that owns no FR-PROD law to
 *    silence the authoritative PROD block (audit HIGH-4): the repository's ACTIVE
 *    milestone (G2) governs, so a PROD-law milestone always requires a complete claim
 *    set. Evaluating the live mid-flight tree therefore legitimately FAILS until the
 *    in-flight G2 packages land; that negative is covered by the HIGH-4 regression in
 *    `packages/release-conformance/test/prod-rules.spec.ts`.
 *  - "all normative items and code paths match perfectly" is assertable here because
 *    every supplied normative item resolves exactly, the PROD claim set is compliant,
 *    and the generated surface documents match deterministic regeneration.
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateConformance } from '@foresift/release-conformance';
import {
  PROD_BEST_EFFORT_COMPLIANT,
  PROD_COMPLIANT_ACTIVE_CLAIM,
  PROD_LIVE_PATH_BOUNDED_CLAIM,
  PROD_MCP_COMPLIANT_CLAIM,
  PROD_TECHNICALLY_READY_CLAIM,
  PROD_WORKSPACE_AUTHORIZED_CLAIM,
} from '../fixtures/prod/index.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * One fully-mapped normative item owned by the authoritative G2 milestone. The
 * implementation reference resolves to a real file in the live tree and the test
 * reference is this suite, so the mapping/active-path/premature rules all pass.
 */
const CONFORMANT_ITEM = {
  id: 'FR-TRACE-003',
  dependencyGroup: 'G2',
  owner: 'packages/release-conformance',
  implementationRefs: ['packages/release-conformance/src/index.ts @requirement FR-TRACE-003'],
  testRefs: ['tests/acceptance/AC-266.spec.ts'],
} as const;

describe('AC-266 acceptance (positive)', () => {
  it('passes release conformance when all normative items and code paths match perfectly', async () => {
    const verdict = await evaluateConformance({
      repoRoot: REPO_ROOT,
      // The authoritative ACTIVE milestone owns FR-PROD law; supply its complete,
      // compliant governance claim set so the PROD block is genuinely evaluated.
      milestone: 'G2',
      requirements: [CONFORMANT_ITEM],
      prodClaims: {
        activationClaims: [PROD_COMPLIANT_ACTIVE_CLAIM],
        postureDeclarations: [PROD_BEST_EFFORT_COMPLIANT],
        mcpCompatibility: PROD_MCP_COMPLIANT_CLAIM,
        livePaths: [PROD_LIVE_PATH_BOUNDED_CLAIM],
        distributionAuthorizations: [PROD_WORKSPACE_AUTHORIZED_CLAIM, PROD_TECHNICALLY_READY_CLAIM],
      },
    });

    expect(verdict).toBeDefined();
    expect(verdict.overall).toBe('PASSED');
    expect(verdict.findings).toEqual([]);
    expect(verdict.totalRulesEvaluated).toBeGreaterThan(0);
  });
});
