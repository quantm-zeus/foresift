// REAL end-to-end RED gate execution (integration tier). Package gates are
// deterministically RED while any manifest-declared verification target is
// still absent, proving the manifest writer's failure direction,
// failedCategories, first-failing-check semantics, and attestation-on-PASS-
// only — all against reality. Which command fails is derived from the same
// version-controlled metadata the gate itself reads, so the deterministic red
// advances down the declared list as G0 packages land instead of being pinned
// to one repo snapshot.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect } from 'vitest';
import {
  GATE_RESULT_FILE,
  parseFullGateResult,
} from '../../scripts/automation/package-full-gate.mjs';
import {
  GATE_E2E_NESTED,
  REPO,
  SCRIPTS,
  itE2e,
  makeScratch,
  tryNode,
} from '../helpers/v2-fixtures.js';

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
      // Gate stops at the FIRST failing package check. The gate derives its
      // commands from specs/implementation/current-milestone.json, so the
      // expectation does too: the FAIL row must be a declared g0-tool-core
      // command, and every DECLARED command before it must have had a
      // satisfied `test -d` target (absent targets fail deterministically, so
      // a satisfied predecessor proves the stop was at the first unsatisfied
      // check — originally packages/domain; since generation-0 landed it is
      // real and green and the red advanced to packages/tool-core).
      const pkgRow = m?.checks.find((c) => c.status === 'FAIL');
      expect(pkgRow?.category).toBe('PACKAGE');
      const msMeta = JSON.parse(
        readFileSync(join(REPO, 'specs', 'implementation', 'current-milestone.json'), 'utf8'),
      ) as { packages?: Array<{ id: string; verificationCommands: string[] }> };
      const declared =
        msMeta.packages?.find((p) => p.id === 'g0-tool-core')?.verificationCommands ?? [];
      const stopIdx = declared.indexOf(pkgRow?.command ?? '');
      expect(stopIdx).toBeGreaterThanOrEqual(0);
      for (const prior of declared.slice(0, stopIdx)) {
        const target = /^test -d (\S+) &&/.exec(prior)?.[1];
        expect(target != null && existsSync(join(REPO, target))).toBe(true);
      }
      // Every pre-package stage ran green before the deterministic red.
      for (const c of m?.checks ?? []) {
        if (c.category !== 'PACKAGE') expect(c.status).toBe('PASS');
      }
      expect(existsSync(join(dir, 'full-gate-attestation.json'))).toBe(false);
    },
    // Budget is load headroom, not scope: this gate runs its TESTS category
    // (a full nested `pnpm test`) and overlaps the green-gate file by design
    // (solo milestone/package gates measured ≈150s at the current suite size;
    // contention roughly doubles that). A hang still fails.
    600_000,
  );
});
