/**
 * Unit suite for IDs management, grammar, global uniqueness, and supersession contract (FR-TRACE-002 / AC-265, AC-266).
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import {
  validateIdGrammar,
  checkGlobalIdUniqueness,
  validateSupersessionContract,
  checkStableOrdering,
  loadRequirementManifest,
} from '../src/index.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
);

describe('requirement manifest IDs (FR-TRACE-002, AC-265, AC-266)', () => {
  describe('ID shape grammar per namespace', () => {
    it('validates correct requirement ID format (FR-*)', () => {
      expect(validateIdGrammar('FR-TRACE-001').valid).toBe(true);
      expect(validateIdGrammar('FR-CORE-005').valid).toBe(true);
      expect(validateIdGrammar('FR-DATA-016').valid).toBe(true);
      expect(validateIdGrammar('FR-INVALID').valid).toBe(false);
      expect(validateIdGrammar('fr-core-001').valid).toBe(false);
    });

    it('validates correct acceptance criteria format (AC-*)', () => {
      expect(validateIdGrammar('AC-001').valid).toBe(true);
      expect(validateIdGrammar('AC-265').valid).toBe(true);
      expect(validateIdGrammar('AC-269').valid).toBe(true);
      expect(validateIdGrammar('AC-1').valid).toBe(false);
      expect(validateIdGrammar('ac-001').valid).toBe(false);
    });

    it('validates correct invariant format (INV-*)', () => {
      expect(validateIdGrammar('INV-001').valid).toBe(true);
      expect(validateIdGrammar('INV-010').valid).toBe(true);
      expect(validateIdGrammar('INV-1').valid).toBe(false);
      expect(validateIdGrammar('inv-001').valid).toBe(false);
    });

    it('validates correct ADR format (ADR-*)', () => {
      expect(validateIdGrammar('ADR-0001').valid).toBe(true);
      expect(validateIdGrammar('ADR-0020').valid).toBe(true);
      expect(validateIdGrammar('ADR-1').valid).toBe(false);
      expect(validateIdGrammar('adr-0001').valid).toBe(false);
    });
  });

  describe('global uniqueness across the FR/AC/INV/ADR union', () => {
    it('confirms all IDs in the live manifest are globally unique with zero collisions', async () => {
      const manifest = await loadRequirementManifest({ manifestPath: MANIFEST_PATH });
      const uniqueness = checkGlobalIdUniqueness(manifest);

      expect(uniqueness.isUnique).toBe(true);
      expect(uniqueness.duplicates).toEqual([]);
      expect(uniqueness.totalIds).toBe(397 + 204 + 44 + 58);
    });

    it('refuses duplicate IDs across or within namespaces', () => {
      const mockManifest = {
        requirements: [{ id: 'FR-COLLISION-001' }],
        acceptanceCriteria: [{ id: 'FR-COLLISION-001' }], // Duplicate in AC
        invariants: [],
        adrs: [],
      };

      const uniqueness = checkGlobalIdUniqueness(mockManifest as any);
      expect(uniqueness.isUnique).toBe(false);
      expect(uniqueness.duplicates).toContain('FR-COLLISION-001');
    });
  });

  describe('stable ordering', () => {
    it('confirms IDs in manifest follow stable ordering', async () => {
      const manifest = await loadRequirementManifest({ manifestPath: MANIFEST_PATH });
      const ordering = checkStableOrdering(manifest);
      expect(ordering.isStable).toBe(true);
    });
  });

  describe('supersession contract', () => {
    it('accepts valid supersession record in ledger', () => {
      const supersessions = [
        {
          replacedId: 'FR-OLD-001',
          supersededById: 'FR-NEW-001',
          namespace: 'requirement',
          recordedAt: '2026-08-31T08:00:00.000Z',
          reason: 'Requirement refined',
        },
      ];

      const check = validateSupersessionContract({
        replacedIds: ['FR-OLD-001'],
        supersessionLedger: supersessions,
      });

      expect(check.valid).toBe(true);
    });

    it('refuses replaced ID that is missing from supersession ledger (SUPERSESSION_LINK_REQUIRED)', () => {
      const supersessions: any[] = [];

      expect(() =>
        validateSupersessionContract({
          replacedIds: ['FR-UNLINKED-001'],
          supersessionLedger: supersessions,
        }),
      ).toThrow(/SUPERSESSION_LINK_REQUIRED|supersession link required/i);
    });

    it('refuses re-use of an already released ID with conflicting definition (ID_REUSE_FORBIDDEN)', () => {
      const historicalIds = new Set(['FR-CORE-001']);

      expect(() =>
        validateSupersessionContract({
          newItems: [{ id: 'FR-CORE-001', text: 'Different conflicting definition' }],
          historicalReleasedIds: historicalIds,
        }),
      ).toThrow(/ID_REUSE_FORBIDDEN|re-use of released id|duplicate id/i);
    });
  });
});
