// REAL end-to-end RED gate execution (integration tier) inside a hermetic
// fixture repository with bounded synthetic commands. Package gates are
// deterministically RED while any manifest-declared verification target is
// still absent, proving the manifest writer's failure direction,
// failedCategories, first-failing-check semantics, and attestation-on-PASS-only.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import {
  GATE_RESULT_FILE,
  parseFullGateResult,
} from '../../scripts/automation/package-full-gate.mjs';
import { disposeGitFixtureBase, gitFixture } from '../helpers/git-fixture.js';
import { REPO, SCRIPTS, itE2e, makeScratch, tryNode } from '../helpers/v2-fixtures.js';

const { art, cleanup } = makeScratch('foresift-v2-c2-red-');
afterAll(() => {
  cleanup();
  disposeGitFixtureBase();
});

describe('V2 structured gate manifest — REAL red package gate (spec §9)', () => {
  itE2e(
    'RED path: package gate fails at its package checks with a structured manifest and NO attestation',
    () => {
      const dir = art('gate-red');
      const fx = gitFixture('hermetic-gate-red');
      fx.writeFile(
        'package.json',
        JSON.stringify({
          name: 'foresift-hermetic-red-gate',
          private: true,
          scripts: {
            'spec:verify': 'node -e "process.exit(0)"',
            'format:check': 'node -e "process.exit(0)"',
            'lint': 'node -e "process.exit(0)"',
            'typecheck': 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
          },
        }),
      );
      fx.writeFile('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
      fx.writeFile(
        'packages/domain/package.json',
        JSON.stringify({
          name: '@foresift/domain',
          scripts: { test: 'node -e "process.exit(0)"' },
        }),
      );
      const r = tryNode(
        [
          join(SCRIPTS, 'foresift-gate.mjs'),
          '--package',
          'g0-tool-core',
          '--result-file',
          join(dir, GATE_RESULT_FILE),
        ],
        {
          cwd: fx.root,
          env: {
            ...process.env,
            FORESIFT_ALLOW_HERMETIC_NESTED_FULL: '1',
          },
        },
      );
      expect(r.status).not.toBe(0);
      const m = parseFullGateResult(readFileSync(join(dir, GATE_RESULT_FILE), 'utf8'));
      expect(m?.passed).toBe(false);
      expect(m?.exitCode).toBe(r.status);
      expect(m?.failedCategories).toEqual(['PACKAGE']);
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
        expect(target != null && existsSync(join(fx.root, target))).toBe(true);
      }
      for (const c of m?.checks ?? []) {
        if (c.category !== 'PACKAGE') expect(c.status).toBe('PASS');
      }
      expect(existsSync(join(dir, 'full-gate-attestation.json'))).toBe(false);
    },
    30_000,
  );

  it(
    'structural nested-full block in foresift-gate.mjs refuses unflagged nested full test executions',
    () => {
      const dir = art('gate-nested-block');
      const fx = gitFixture('hermetic-gate-nested-block');
      fx.writeFile(
        'package.json',
        JSON.stringify({
          name: 'foresift-hermetic-nested-block',
          private: true,
          scripts: {
            'spec:verify': 'node -e "process.exit(0)"',
            'format:check': 'node -e "process.exit(0)"',
            'lint': 'node -e "process.exit(0)"',
            'typecheck': 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
          },
        }),
      );
      const r = tryNode(
        [
          join(SCRIPTS, 'foresift-gate.mjs'),
          '--milestone',
          '--result-file',
          join(dir, GATE_RESULT_FILE),
        ],
        {
          cwd: fx.root,
          env: {
            ...process.env,
            FORESIFT_ALLOW_HERMETIC_NESTED_FULL: '0',
            FORESIFT_TEST_AUTHORITY: '1',
          },
        },
      );
      expect(r.status).toBe(86);
      const m = parseFullGateResult(readFileSync(join(dir, GATE_RESULT_FILE), 'utf8'));
      expect(m?.passed).toBe(false);
      expect(m?.exitCode).toBe(86);
      expect(m?.failedCategories).toEqual(['TESTS']);
      const testCheck = m?.checks.find((c) => c.category === 'TESTS');
      expect(testCheck?.status).toBe('FAIL');
    },
    30_000,
  );
});
