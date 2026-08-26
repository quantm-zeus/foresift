// REAL end-to-end GREEN gate execution (integration tier) inside a hermetic
// fixture repository with bounded synthetic commands. Proves the manifest
// writer's all-PASS direction against reality with zero recursive repo execution.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect } from 'bun:test';
import {
  GATE_RESULT_FILE,
  parseFullGateResult,
} from '../../scripts/automation/package-full-gate.mjs';
import { disposeGitFixtureBase, gitFixture } from '../helpers/git-fixture.js';
import { SCRIPTS, itE2e, makeScratch } from '../helpers/v2-fixtures.js';

const { art, cleanup } = makeScratch('foresift-v2-c2-green-');
afterAll(() => {
  cleanup();
  disposeGitFixtureBase();
});

describe('V2 structured gate manifest — REAL green milestone gate (spec §9)', () => {
  itE2e(
    'GREEN path: milestone gate passes and writes an all-PASS manifest with every category',
    () => {
      const dir = art('gate-green');
      const fx = gitFixture('hermetic-gate-green');
      fx.writeFile(
        'package.json',
        JSON.stringify({
          name: 'foresift-hermetic-green-gate',
          private: true,
          scripts: {
            'spec:verify': 'node -e "process.exit(0)"',
            'format:check': 'node -e "process.exit(0)"',
            lint: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
          },
        }),
      );
      execFileSync(
        'node',
        [
          join(SCRIPTS, 'foresift-gate.mjs'),
          '--milestone',
          '--result-file',
          join(dir, GATE_RESULT_FILE),
        ],
        {
          encoding: 'utf8',
          cwd: fx.root,
          env: {
            ...process.env,
            FORESIFT_ALLOW_HERMETIC_NESTED_FULL: '1',
          },
        },
      );
      const m = parseFullGateResult(readFileSync(join(dir, GATE_RESULT_FILE), 'utf8'));
      expect(m).not.toBeNull();
      expect(m?.passed).toBe(true);
      expect(m?.failedCategories).toEqual([]);
      const cats = m?.checks.map((c) => c.category);
      expect(cats).toEqual(['SPEC', 'FORMAT', 'LINT', 'TYPECHECK', 'TESTS']);
      for (const c of m?.checks ?? []) expect(c.status).toBe('PASS');
    },
    30_000,
  );
});
