// tests/automation/ci-repair-lifecycle.spec.ts — Behavioral tests for CI repair lifecycle and ownership guards.
// Matrix from Task Spec §21.

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitFixture } from '../helpers/git-fixture.js';
import {
  captureCiIncident,
  classifyCiFailure,
  selectCiRepairRoute,
  triageTestDispute,
} from '../../scripts/automation/ci-authority.mjs';
import {
  executeFormatRepair,
  executeInfraRetry,
  loadRepairAttempts,
  incrementRepairAttempts,
} from '../../scripts/automation/ci-repair-executor.mjs';
import { validateLaneOwnership } from '../../scripts/automation/path-ownership.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'ci-repair-lifecycle-'));

describe('CI Repair Lifecycle & Ownership Matrix (§21)', () => {
  it('A. FORMAT known changed file → deterministic formatter → zero AI → new HEAD', () => {
    const gitFix = gitFixture('rep-format-known');
    gitFix.writeFile('packages/core/src/index.ts', 'const x=1;\n');
    gitFix.commitAll('chore: base code');

    // Create branch
    gitFix.g(['checkout', '-b', 'fix/format-branch']);
    // Unformatted content
    gitFix.writeFile('packages/core/src/index.ts', 'const   x  =  { a:1,b:2 };\n');
    gitFix.commitAll('fix: unformatted change');
    const unformattedHead = gitFix.baseSha();

    const formatResult = executeFormatRepair({
      failedFiles: ['packages/core/src/index.ts'],
      prChangedFiles: ['packages/core/src/index.ts'],
      worktreeDir: gitFix.root,
      branch: 'fix/format-branch',
    });

    expect(formatResult.ok).toBe(true);
    expect(formatResult.newHead).toBeDefined();
    expect(formatResult.newHead).not.toBe(unformattedHead);

    const formattedContent = readFileSync(join(gitFix.root, 'packages/core/src/index.ts'), 'utf8');
    // Prettier formatting removes excessive spaces
    expect(formattedContent).not.toContain('const   x  =');
  });

  it('B. FORMAT unknown file → no broad formatter (refuses to format whole repo)', () => {
    const gitFix = gitFixture('rep-format-unknown');
    const formatResult = executeFormatRepair({
      failedFiles: [],
      prChangedFiles: ['packages/core/src/index.ts'],
      worktreeDir: gitFix.root,
      branch: 'main',
    });

    expect(formatResult.ok).toBe(false);
    expect(formatResult.reason).toContain('no safe targets');
  });

  it('C. INFRA → bounded retry → zero AI turns', () => {
    let waitSum = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const infra = executeInfraRetry({ attempt, maxRetries: 3 });
      expect(infra.ok).toBe(true);
      expect(infra.waitMs).toBeGreaterThan(0);
      waitSum += infra.waitMs;
    }
    expect(waitSum).toBeGreaterThan(0);

    const exhausted = executeInfraRetry({ attempt: 4, maxRetries: 3 });
    expect(exhausted.ok).toBe(false);
    expect(exhausted.waitMs).toBe(0);
  });

  it('D. Product TS/lint failure → Codex repair routed', () => {
    const log = `packages/cost-router/src/router.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.`;
    const classification = classifyCiFailure(log);
    expect(classification.category).toBe('TYPECHECK');

    const route = selectCiRepairRoute({
      classification,
      executionProfile: 'CODEX_AGY',
      failedFiles: classification.failedFiles,
      prChangedFiles: ['packages/cost-router/src/router.ts'],
    });

    expect(route.engine).toBe('CODEX');
    expect(route.route).toBe('CODEX_IMPLEMENTATION_REPAIR');
  });

  it('E. Test helper syntax/type failure → AGY repair routed', () => {
    const log = `tests/helpers/v2-fixtures.ts(5,1): error TS2304: Cannot find name 'bun'.`;
    const classification = classifyCiFailure(log);
    expect(classification.category).toBe('TYPECHECK');

    const route = selectCiRepairRoute({
      classification,
      executionProfile: 'CODEX_AGY',
      failedFiles: classification.failedFiles,
      prChangedFiles: ['tests/helpers/v2-fixtures.ts'],
    });

    expect(route.engine).toBe('AGY');
    expect(route.route).toBe('AGY_TEST_REPAIR');
  });

  it('F. Assertion failure + product changed, test unchanged → Codex', () => {
    const log = `
    FAIL tests/acceptance/AC-271.spec.ts
    × should compute correct cost quotas [tests/acceptance/AC-271.spec.ts]
      at expect (packages/cost-router/src/router.ts:45:12)
    `;
    const classification = classifyCiFailure(log);

    const route = selectCiRepairRoute({
      classification,
      executionProfile: 'CODEX_AGY',
      failedFiles: ['tests/acceptance/AC-271.spec.ts'],
      prChangedFiles: ['packages/cost-router/src/router.ts'],
    });

    expect(route.engine).toBe('CODEX');
    expect(route.route).toBe('CODEX_IMPLEMENTATION_REPAIR');
  });

  it('G. Assertion failure + only test changed → AGY', () => {
    const log = `
    FAIL tests/acceptance/AC-271.spec.ts
    × should compute correct cost quotas [tests/acceptance/AC-271.spec.ts]
    `;
    const classification = classifyCiFailure(log);

    const route = selectCiRepairRoute({
      classification,
      executionProfile: 'CODEX_AGY',
      failedFiles: ['tests/acceptance/AC-271.spec.ts'],
      prChangedFiles: ['tests/acceptance/AC-271.spec.ts'],
    });

    expect(route.engine).toBe('AGY');
    expect(route.route).toBe('AGY_TEST_REPAIR');
  });

  it('H. Assertion failure + both product and test changed → TEST_DISPUTE', () => {
    const log = `
    FAIL tests/acceptance/AC-271.spec.ts
    × should compute correct cost quotas [tests/acceptance/AC-271.spec.ts]
    `;
    const classification = classifyCiFailure(log);

    const route = selectCiRepairRoute({
      classification,
      executionProfile: 'CODEX_AGY',
      failedFiles: ['tests/acceptance/AC-271.spec.ts'],
      prChangedFiles: ['packages/cost-router/src/router.ts', 'tests/acceptance/AC-271.spec.ts'],
    });

    expect(route.route).toBe('TEST_DISPUTE');
  });

  it('I. TEST_DISPUTE triage TEST_VALID → Codex repairs product code', () => {
    const triage = triageTestDispute({
      disputeAssessment: 'TEST_VALID',
      productFiles: ['packages/cost-router/src/router.ts'],
      testFiles: ['tests/acceptance/AC-271.spec.ts'],
    });

    expect(triage.decision).toBe('TEST_VALID');
    expect(triage.nextRoute.engine).toBe('CODEX');
    expect(triage.nextRoute.route).toBe('CODEX_IMPLEMENTATION_REPAIR');
  });

  it('J. TEST_DISPUTE triage TEST_DEFECT → AGY repairs test code', () => {
    const triage = triageTestDispute({
      disputeAssessment: 'TEST_DEFECT',
      productFiles: ['packages/cost-router/src/router.ts'],
      testFiles: ['tests/acceptance/AC-271.spec.ts'],
    });

    expect(triage.decision).toBe('TEST_DEFECT');
    expect(triage.nextRoute.engine).toBe('AGY');
    expect(triage.nextRoute.route).toBe('AGY_TEST_REPAIR');
  });

  it('K. TEST_DISPUTE triage INCONCLUSIVE → maintainer escalation', () => {
    const triage = triageTestDispute({
      disputeAssessment: 'INCONCLUSIVE',
      productFiles: ['packages/cost-router/src/router.ts'],
      testFiles: ['tests/acceptance/AC-271.spec.ts'],
    });

    expect(triage.decision).toBe('INCONCLUSIVE');
    expect(triage.nextRoute.route).toBe('MAINTAINER_ESCALATION');
  });

  it('L. Codex edits test file → rejected via ownership guard', () => {
    const ownership = validateLaneOwnership({
      engine: 'CODEX',
      role: 'implementation',
      changedPaths: ['packages/core/src/index.ts', 'tests/acceptance/AC-001.spec.ts'],
    });

    expect(ownership.ok).toBe(false);
    expect(ownership.violationCode).toBe('CODEX_TEST_OWNERSHIP_VIOLATION');
    expect(ownership.violatingPaths).toContain('tests/acceptance/AC-001.spec.ts');
  });

  it('M. AGY edits product file → rejected via ownership guard', () => {
    const ownership = validateLaneOwnership({
      engine: 'AGY',
      role: 'test',
      changedPaths: ['tests/acceptance/AC-001.spec.ts', 'packages/core/src/index.ts'],
    });

    expect(ownership.ok).toBe(false);
    expect(ownership.violationCode).toBe('AGY_PRODUCT_OWNERSHIP_VIOLATION');
    expect(ownership.violatingPaths).toContain('packages/core/src/index.ts');
  });

  it('N. Same SHA incident repeated → deduplicated', () => {
    const stateDir = join(scratch, 'incident-dedupe');
    mkdirSync(stateDir, { recursive: true });

    // Fake ghFn for getExactHeadCiStatus returning failure
    const ghFn = (args: string[]) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'failure',
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return { ok: true, stdout: '[]', stderr: '', status: 0 };
    };

    const res1 = captureCiIncident({
      sha: 'abcdef1234567890',
      stateDir,
      ghFn,
    });
    expect(res1?.deduplicated).toBe(false);

    const res2 = captureCiIncident({
      sha: 'abcdef1234567890',
      stateDir,
      ghFn,
    });
    expect(res2?.deduplicated).toBe(true);
  });

  it('O. New repaired HEAD → new incident identity', () => {
    const stateDir = join(scratch, 'incident-new-head');
    mkdirSync(stateDir, { recursive: true });

    const ghFn = (args: string[]) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'failure',
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return { ok: true, stdout: '[]', stderr: '', status: 0 };
    };

    const res1 = captureCiIncident({
      sha: 'sha-head-1',
      stateDir,
      ghFn,
    });

    const res2 = captureCiIncident({
      sha: 'sha-head-2',
      stateDir,
      ghFn,
    });

    expect(res1?.capsule.eventId).not.toBe(res2?.capsule.eventId);
  });

  it('P. Repair budget survives process restart', () => {
    const incidentDir = join(scratch, 'budget-restart', 'maintainer-incidents');
    mkdirSync(incidentDir, { recursive: true });
    const incidentPath = join(incidentDir, 'ci-failure-test-budget.json');

    writeFileSync(
      incidentPath,
      JSON.stringify({
        schema: 'foresift/ci-failure-incident@1',
        sha: 'test-budget-sha',
        repairAttempts: 0,
      }) + '\n',
    );

    const count1 = incrementRepairAttempts(incidentPath);
    expect(count1).toBe(1);

    // Simulate process restart: read from disk
    const loaded = loadRepairAttempts(incidentPath);
    expect(loaded).toBe(1);

    const count2 = incrementRepairAttempts(incidentPath);
    expect(count2).toBe(2);
  });
});
