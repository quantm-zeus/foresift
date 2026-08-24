// REAL end-to-end GREEN gate execution (integration tier). The milestone gate
// is deterministically GREEN in this control-plane-only repository, proving
// the manifest writer's all-PASS direction against reality. Runs as its own
// FILE so vitest executes it concurrently with the red-gate file instead of
// serially (36s → ~20s measured at the C2.5 baseline).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect } from 'vitest';
import {
  GATE_RESULT_FILE,
  parseFullGateResult,
} from '../../scripts/automation/package-full-gate.mjs';
import { GATE_E2E_NESTED, REPO, SCRIPTS, itE2e, makeScratch } from '../helpers/v2-fixtures.js';

const { art, cleanup } = makeScratch('foresift-v2-c2-green-');
afterAll(cleanup);

describe('V2 structured gate manifest — REAL green milestone gate (spec §9)', () => {
  itE2e(
    'GREEN path: milestone gate passes and writes an all-PASS manifest with every category',
    () => {
      const dir = art('gate-green');
      execFileSync(
        'node',
        [
          join(SCRIPTS, 'foresift-gate.mjs'),
          '--milestone',
          '--result-file',
          join(dir, GATE_RESULT_FILE),
        ],
        { encoding: 'utf8', cwd: REPO, env: { ...process.env, [GATE_E2E_NESTED]: '1' } },
      );
      const m = parseFullGateResult(readFileSync(join(dir, GATE_RESULT_FILE), 'utf8'));
      expect(m).not.toBeNull();
      expect(m?.passed).toBe(true);
      expect(m?.failedCategories).toEqual([]);
      const cats = m?.checks.map((c) => c.category);
      expect(cats).toEqual(['SPEC', 'FORMAT', 'LINT', 'TYPECHECK', 'TESTS']);
      for (const c of m?.checks ?? []) expect(c.status).toBe('PASS');
    },
    // Budget is load headroom, not scope: the nested milestone gate measures
    // ≈150s solo at the current suite size and overlaps the red-gate file by
    // design, so both REAL gates contend for the same CPUs. A hang still fails.
    600_000,
  );
});
