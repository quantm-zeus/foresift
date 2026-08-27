import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyCiFailure,
  getExactHeadCiStatus,
  getMainCiStatus,
  validateDirectMainPushWhitelist,
  captureCiIncident,
} from '../../scripts/automation/ci-authority.mjs';

describe('CI Authority & Merge Invariants (V4 Hard Invariants A-F)', () => {
  const root = process.cwd();

  it('1. PR check pending -> merge prohibited', () => {
    const mockGh = () => ({
      ok: true,
      stdout: JSON.stringify([
        {
          name: 'Verify (spec, format, lint, types, tests)',
          status: 'in_progress',
          conclusion: null,
        },
      ]),
    });
    const status = getExactHeadCiStatus({
      sha: 'a1b2c3d4e5f6',
      ghFn: mockGh,
    });
    expect(status.ok).toBe(false);
    expect(status.state).toBe('PENDING');
  });

  it('2. PR check failure -> merge prohibited', () => {
    const mockGh = () => ({
      ok: true,
      stdout: JSON.stringify([
        {
          name: 'Verify (spec, format, lint, types, tests)',
          status: 'completed',
          conclusion: 'failure',
        },
      ]),
    });
    const status = getExactHeadCiStatus({
      sha: 'a1b2c3d4e5f6',
      ghFn: mockGh,
    });
    expect(status.ok).toBe(false);
    expect(status.state).toBe('FAILURE');
    expect(status.failureSummary).toContain('failure');
  });

  it('3. exact-head check success -> merge allowed', () => {
    const mockGh = () => ({
      ok: true,
      stdout: JSON.stringify([
        {
          name: 'Verify (spec, format, lint, types, tests)',
          status: 'completed',
          conclusion: 'success',
        },
      ]),
    });
    const status = getExactHeadCiStatus({
      sha: 'a1b2c3d4e5f6',
      ghFn: mockGh,
    });
    expect(status.ok).toBe(true);
    expect(status.state).toBe('SUCCESS');
  });

  it('4. stale green SHA does not authorize newer PR HEAD', () => {
    const staleSha = 'stale11111111111111111111111111111111111';
    const newerSha = 'newer22222222222222222222222222222222222';
    const mockGh = (args: string[]) => {
      const endpoint = args[1] || '';
      if (endpoint.includes(staleSha)) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'success',
            },
          ]),
        };
      }
      return {
        ok: true,
        stdout: JSON.stringify([
          {
            name: 'Verify (spec, format, lint, types, tests)',
            status: 'in_progress',
            conclusion: null,
          },
        ]),
      };
    };

    const newerStatus = getExactHeadCiStatus({
      sha: newerSha,
      ghFn: mockGh,
    });
    expect(newerStatus.ok).toBe(false);
    expect(newerStatus.state).toBe('PENDING');
  });

  it('5. admin capability does not bypass policy in package-land.mjs', () => {
    const landerCode = readFileSync(
      join(root, 'scripts', 'automation', 'package-land.mjs'),
      'utf8',
    );
    expect(landerCode).not.toContain('--admin');
    expect(landerCode).toContain("sh('gh', ['pr', 'merge', prNum, '--squash'])");
  });

  it('6. main CI red -> next product package selection blocked', () => {
    const mockGit = () => ({ ok: true, stdout: 'deadbeef1234567890' });
    const mockGh = () => ({
      ok: true,
      stdout: JSON.stringify([
        {
          name: 'Verify (spec, format, lint, types, tests)',
          status: 'completed',
          conclusion: 'failure',
        },
      ]),
    });
    const mainStatus = getMainCiStatus({
      gitFn: mockGit,
      ghFn: mockGh,
    });
    expect(mainStatus.ok).toBe(false);
    expect(mainStatus.state).toBe('RED');
  });

  it('7. main CI cancelled/timed out -> blocked', () => {
    const mockGit = () => ({ ok: true, stdout: 'deadbeef1234567890' });
    const mockGh = () => ({
      ok: true,
      stdout: JSON.stringify([
        {
          name: 'Verify (spec, format, lint, types, tests)',
          status: 'completed',
          conclusion: 'timed_out',
        },
      ]),
    });
    const mainStatus = getMainCiStatus({
      gitFn: mockGit,
      ghFn: mockGh,
    });
    expect(mainStatus.ok).toBe(false);
    expect(mainStatus.state).toBe('RED');
  });

  it('8. main CI green -> product selection may proceed', () => {
    const mockGit = () => ({ ok: true, stdout: 'green1234567890' });
    const mockGh = () => ({
      ok: true,
      stdout: JSON.stringify([
        {
          name: 'Verify (spec, format, lint, types, tests)',
          status: 'completed',
          conclusion: 'success',
        },
      ]),
    });
    const mainStatus = getMainCiStatus({
      gitFn: mockGit,
      ghFn: mockGh,
    });
    expect(mainStatus.ok).toBe(true);
    expect(mainStatus.state).toBe('GREEN');
  });

  it('9. direct-main state commit cannot include product/test/config changes', () => {
    // Valid state-only paths
    expect(
      validateDirectMainPushWhitelist(['specs/implementation/current-milestone.json']).allowed,
    ).toBe(true);
    expect(
      validateDirectMainPushWhitelist([
        'specs/g0-cost-capacity/plan.md',
        'specs/g0-cost-capacity/spec.md',
        'specs/g0-cost-capacity/tasks.md',
      ]).allowed,
    ).toBe(true);

    // Prohibited modifications
    expect(validateDirectMainPushWhitelist(['packages/persistence/src/index.ts']).allowed).toBe(
      false,
    );
    expect(validateDirectMainPushWhitelist(['package.json']).allowed).toBe(false);
    expect(validateDirectMainPushWhitelist(['tests/acceptance/AC-001.spec.ts']).allowed).toBe(
      false,
    );
    expect(validateDirectMainPushWhitelist(['.github/workflows/ci.yml']).allowed).toBe(false);
  });

  it('10. CI failure generates one incident capsule, not repeated AI polling', () => {
    const mockGh = (args: string[]) => {
      if (args[0] === 'api') {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'failure',
            },
          ]),
        };
      }
      if (args[0] === 'run' && args[1] === 'list') {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              databaseId: 12345678,
              url: 'https://github.com/quantm-zeus/foresift/actions/runs/12345678',
              status: 'completed',
              conclusion: 'failure',
            },
          ]),
        };
      }
      if (args[0] === 'run' && args[1] === 'view') {
        return {
          ok: true,
          stdout:
            'Code style issues found in 2 files. Run Prettier with --write to fix.\n[warn] evidence/manifest.json\n[warn] evidence/proof.json',
        };
      }
      return { ok: true, stdout: '' };
    };

    const tmpDir = join(root, '.local', 'state', 'foresift-test-tmp');
    const result = captureCiIncident({
      sha: 'testfailsha123',
      stateDir: tmpDir,
      ghFn: mockGh,
    });
    expect(result).not.toBeNull();
    expect(result!.capsule.classification.category).toBe('FORMAT');
    expect(result!.capsule.classification.failedFiles).toContain('evidence/manifest.json');
    expect(existsSync(result!.filePath)).toBe(true);
  });

  it('11. formatting failure is surfaced with exact files/log tail', () => {
    const sampleLog = `
$ prettier --check .
Checking formatting...
[warn] evidence/bun-migration/bun-migration-manifest.json
[warn] evidence/bun-migration/bun-migration-proof.json
[warn] Code style issues found in 2 files. Run Prettier with --write to fix.
    `;
    const classified = classifyCiFailure(sampleLog);
    expect(classified.category).toBe('FORMAT');
    expect(classified.repairable).toBe(true);
    expect(classified.failedFiles).toContain('evidence/bun-migration/bun-migration-manifest.json');
    expect(classified.failedFiles).toContain('evidence/bun-migration/bun-migration-proof.json');
  });

  it('12. no gh pr merge --admin remains in normal workflows', () => {
    const workflowsDir = join(root, '.archon', 'workflows');
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walk(full));
        else if (ent.name.endsWith('.yaml') || ent.name.endsWith('.yml')) out.push(full);
      }
      return out;
    };
    const files = existsSync(workflowsDir) ? walk(workflowsDir) : [];
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      expect(content).not.toContain('gh pr merge "$PR" --squash --admin');
      expect(content).not.toContain('gh pr merge $PR --squash --admin');
      expect(content).not.toContain('gh pr merge --admin');
    }
  });
});
