/**
 * Unit suite for orphan product file detection and exception ledger validation (FR-TRACE-003 / AC-266).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- salvaged lane tests: mock objects cast against a runtime-typed surface (see tests/automation/state-authority-v2.spec.ts convention) */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectOrphanSources,
  loadOrphanExceptions,
  validateOrphanExceptionLedger,
} from '../src/index.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EXCEPTIONS_PATH = path.join(
  REPO_ROOT,
  'packages/release-conformance/src/orphan-exceptions.json',
);

describe('orphan source detection and exception ledger (FR-TRACE-003, AC-266)', () => {
  describe('orphan exception ledger schema and validity', () => {
    it('loads and validates the orphan exception ledger file', async () => {
      const ledger = await loadOrphanExceptions(EXCEPTIONS_PATH);
      expect(ledger).toBeDefined();
      expect(Array.isArray(ledger.exceptions)).toBe(true);

      const validation = validateOrphanExceptionLedger(ledger);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it('confirms every ledger entry names serving requirement IDs and non-empty justification', async () => {
      const ledger = await loadOrphanExceptions(EXCEPTIONS_PATH);
      for (const entry of ledger.exceptions) {
        expect(entry.pathPattern).toBeDefined();
        expect(typeof entry.pathPattern).toBe('string');
        expect(entry.servingRequirementIds.length).toBeGreaterThan(0);
        expect(entry.justification.trim().length).toBeGreaterThan(0);
      }
    });

    it('covers known infrastructure and wiring paths in exceptions', async () => {
      const ledger = await loadOrphanExceptions(EXCEPTIONS_PATH);
      const patterns = ledger.exceptions.map((e: any) => e.pathPattern);

      expect(patterns.some((p: string) => p.includes('packages/object-store'))).toBe(true);
      expect(
        patterns.some(
          (p: string) =>
            p.includes('collector-checkpoints') || p.includes('collector-gap-recovery'),
        ),
      ).toBe(true);
      expect(patterns.some((p: string) => p.includes('apps/api'))).toBe(true);
    });
  });

  describe('orphan source detection logic', () => {
    it('evaluates product sources and confirms no unexempted orphans in active tree', async () => {
      const result = await detectOrphanSources({ repoRoot: REPO_ROOT });
      expect(result.unexemptedOrphans).toEqual([]);
      expect(result.passed).toBe(true);
    });

    it('flags unmapped product source file when not listed in exception ledger', () => {
      const mockProductFiles = ['packages/new-unmapped-package/src/rogue.ts'];
      const mockImplementationRefs = ['packages/known-pkg/** @requirement FR-CORE-001'];
      const mockExceptions: any[] = [];

      const result = detectOrphanSources({
        productFiles: mockProductFiles,
        implementationRefs: mockImplementationRefs,
        exceptions: mockExceptions,
      });

      expect(result.passed).toBe(false);
      expect(result.unexemptedOrphans).toContain('packages/new-unmapped-package/src/rogue.ts');
    });

    it('passes when an unmapped file matches an allowed exception pattern', () => {
      const mockProductFiles = ['packages/object-store/src/driver.ts'];
      const mockImplementationRefs: string[] = [];
      const mockExceptions = [
        {
          pathPattern: 'packages/object-store/src/**',
          servingRequirementIds: ['FR-DATA-005'],
          justification: 'Serves object storage substrate',
        },
      ];

      const result = detectOrphanSources({
        productFiles: mockProductFiles,
        implementationRefs: mockImplementationRefs,
        exceptions: mockExceptions,
      });

      expect(result.passed).toBe(true);
      expect(result.unexemptedOrphans).toEqual([]);
      expect(result.exemptedOrphans).toContain('packages/object-store/src/driver.ts');
    });
  });
});
