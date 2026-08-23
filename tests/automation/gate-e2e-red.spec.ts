// REAL end-to-end RED gate execution (integration tier). Any package gate is
// deterministically RED here (product packages/* do not exist yet), proving
// the manifest writer's failure direction, failedCategories, first-failing-
// check semantics, and attestation-on-PASS-only — all against reality.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect } from 'vitest';
import {
  GATE_RESULT_FILE,
  parseFullGateResult,
} from '../../scripts/automation/package-full-gate.mjs';
import { GATE_E2E_NESTED, SCRIPTS, itE2e, makeScratch, tryNode } from '../helpers/v2-fixtures.js';

const { art, cleanup } = makeScratch('foresift-v2-c2-red-');
afterAll(cleanup);

describe('V2 structured gate manifest — REAL red package gate (spec §9)', () => {
  // itE2e (not it): the red gate runs its TESTS category (a full `pnpm test`)
  // BEFORE failing at PACKAGE, so an unguarded execution inside a nested gate
  // suite would re-spawn gates without bound (fork-bomb, observed 2026-08-23).
  itE2e(
    'RED path: package gate fails at its package checks with a structured manifest and NO attestation',
    () => {
      const dir = art('gate-red');
      const r = tryNode(
        [
          join(SCRIPTS, 'foresift-gate.mjs'),
          '--package',
          'g0-tool-core',
          '--result-file',
          join(dir, GATE_RESULT_FILE),
        ],
        { env: { ...process.env, [GATE_E2E_NESTED]: '1' } },
      );
      expect(r.status).not.toBe(0);
      const m = parseFullGateResult(readFileSync(join(dir, GATE_RESULT_FILE), 'utf8'));
      expect(m?.passed).toBe(false);
      expect(m?.exitCode).toBe(r.status);
      expect(m?.failedCategories).toEqual(['PACKAGE']);
      // Gate stops at the FIRST failing package check (packages/domain is absent).
      const pkgRow = m?.checks.find((c) => c.status === 'FAIL');
      expect(pkgRow?.category).toBe('PACKAGE');
      expect(pkgRow?.command).toMatch(
        /test -d packages\/domain && pnpm --filter @foresift\/domain test/,
      );
      // Every pre-package stage ran green before the deterministic red.
      for (const c of m?.checks ?? []) {
        if (c.category !== 'PACKAGE') expect(c.status).toBe('PASS');
      }
      expect(existsSync(join(dir, 'full-gate-attestation.json'))).toBe(false);
    },
    240_000,
  );
});
