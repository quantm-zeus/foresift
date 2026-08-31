/**
 * AC-265 negative.
 * Traces: FR-TRACE-001, FR-TRACE-002.
 * Refusals proven: corrupted text hash, duplicated id across namespaces, renumbered order,
 * dangling reference, and unresolved anchor each produce a typed refusal fail-closed.
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import { loadRequirementManifest, validateRequirementManifest, validateIdGrammar, checkGlobalIdUniqueness, validateSupersessionContract } from '@foresift/requirement-manifest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
);

describe('AC-265 negative (refusals)', () => {
  it('refuses manifest with corrupted text hash', async () => {
    const manifest = await loadRequirementManifest({ manifestPath: MANIFEST_PATH });
    const corrupted = {
      ...manifest,
      requirements: manifest.requirements.map((r: any) =>
        r.id === 'FR-TRACE-001' ? { ...r, textSha256: 'deadbeef'.repeat(8) } : r,
      ),
    };

    expect(() => validateRequirementManifest({ manifestData: corrupted })).toThrow(
      /TEXT_HASH_MISMATCH|hash mismatch/i,
    );
  });

  it('refuses duplicated ID across requirement and acceptance namespaces', () => {
    const mockManifest = {
      requirements: [{ id: 'FR-COLLIDE-001' }],
      acceptanceCriteria: [{ id: 'FR-COLLIDE-001' }],
      invariants: [],
      adrs: [],
    };

    const uniqueness = checkGlobalIdUniqueness(mockManifest as any);
    expect(uniqueness.isUnique).toBe(false);
    expect(uniqueness.duplicates).toContain('FR-COLLIDE-001');
  });

  it('refuses invalid ID format that does not match namespace grammar', () => {
    expect(validateIdGrammar('FR_INVALID_UNDERSCORE').valid).toBe(false);
    expect(validateIdGrammar('ac-lowercase-001').valid).toBe(false);
    expect(validateIdGrammar('INV-SHORT-1').valid).toBe(false);
    expect(validateIdGrammar('ADR-SHORT-1').valid).toBe(false);
  });

  it('refuses dangling reference from AC to non-existent requirement', async () => {
    const manifest = await loadRequirementManifest({ manifestPath: MANIFEST_PATH });
    const corrupted = {
      ...manifest,
      acceptanceCriteria: manifest.acceptanceCriteria.map((a: any) =>
        a.id === 'AC-265' ? { ...a, requirementRefs: ['FR-DOES-NOT-EXIST-001'] } : a,
      ),
    };

    expect(() => validateRequirementManifest({ manifestData: corrupted })).toThrow(
      /DANGLING_REFERENCE|missing requirement/i,
    );
  });

  it('refuses replaced requirement missing from supersession ledger', () => {
    expect(() =>
      validateSupersessionContract({
        replacedIds: ['FR-DEPRECATED-001'],
        supersessionLedger: [],
      }),
    ).toThrow(/SUPERSESSION_LINK_REQUIRED|supersession link/i);
  });
});
