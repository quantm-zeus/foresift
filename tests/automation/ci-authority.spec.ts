import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_REQUIRED_APP_ID,
  DEFAULT_REQUIRED_CHECK,
  DEFAULT_REPO,
  STATE_ONLY_WHITELIST,
  classifyCiFailure,
  getExactHeadCiStatus,
  getMainCiStatus,
  selectCiRepairRoute,
  validateDirectMainPushWhitelist,
  captureCiIncident,
} from '../../scripts/automation/ci-authority.mjs';
import { auditGitHubProtection } from '../../scripts/automation/audit-github-protection.mjs';

describe('CI Authority & Merge Invariants (V4 Hard Invariants A-F & Hardening)', () => {
  const root = process.cwd();

  describe('Finding 1: Main CI Admission Fail-Closed Gate', () => {
    it('blocks on fetch failure', () => {
      const mockGit = (args: string[]) => {
        if (args[0] === 'fetch')
          return { ok: false, stdout: '', stderr: 'fatal: repository not found' };
        return { ok: true, stdout: 'sha123' };
      };
      const mainStatus = getMainCiStatus({ gitFn: mockGit });
      expect(mainStatus.ok).toBe(false);
      expect(mainStatus.state).toBe('FETCH_ERROR');
      expect(mainStatus.reason).toContain('git fetch origin main failed');
    });

    it('blocks on rev-parse failure', () => {
      const mockGit = (args: string[]) => {
        if (args[0] === 'fetch') return { ok: true, stdout: '' };
        if (args[0] === 'rev-parse')
          return { ok: false, stdout: '', stderr: 'fatal: bad revision' };
        return { ok: true, stdout: '' };
      };
      const mainStatus = getMainCiStatus({ gitFn: mockGit });
      expect(mainStatus.ok).toBe(false);
      expect(mainStatus.state).toBe('REV_PARSE_ERROR');
      expect(mainStatus.reason).toContain('unable to resolve origin/main commit sha');
    });

    it('blocks when main check is MISSING', () => {
      const mockGit = () => ({ ok: true, stdout: 'sha1234567890' });
      const mockGh = () => ({ ok: true, stdout: JSON.stringify([]) });
      const mainStatus = getMainCiStatus({ gitFn: mockGit, ghFn: mockGh });
      expect(mainStatus.ok).toBe(false);
      expect(mainStatus.state).toBe('MISSING');
    });

    it('blocks when main check encounters API_ERROR', () => {
      const mockGit = () => ({ ok: true, stdout: 'sha1234567890' });
      const mockGh = () => ({ ok: false, stdout: '', stderr: 'HTTP 500' });
      const mainStatus = getMainCiStatus({ gitFn: mockGit, ghFn: mockGh });
      expect(mainStatus.ok).toBe(false);
      expect(mainStatus.state).toBe('API_ERROR');
    });

    it('blocks when main check encounters API_UNPARSEABLE', () => {
      const mockGit = () => ({ ok: true, stdout: 'sha1234567890' });
      const mockGh = () => ({ ok: true, stdout: 'not json' });
      const mainStatus = getMainCiStatus({ gitFn: mockGit, ghFn: mockGh });
      expect(mainStatus.ok).toBe(false);
      expect(mainStatus.state).toBe('API_UNPARSEABLE');
    });

    it('blocks when main check is PENDING', () => {
      const mockGit = () => ({ ok: true, stdout: 'sha1234567890' });
      const mockGh = () => ({
        ok: true,
        stdout: JSON.stringify([
          {
            name: DEFAULT_REQUIRED_CHECK,
            status: 'in_progress',
            conclusion: null,
            app_id: DEFAULT_REQUIRED_APP_ID,
          },
        ]),
      });
      const mainStatus = getMainCiStatus({ gitFn: mockGit, ghFn: mockGh });
      expect(mainStatus.ok).toBe(false);
      expect(mainStatus.state).toBe('PENDING');
    });

    it('blocks when main check is RED / FAILURE', () => {
      const mockGit = () => ({ ok: true, stdout: 'sha1234567890' });
      const mockGh = () => ({
        ok: true,
        stdout: JSON.stringify([
          {
            name: DEFAULT_REQUIRED_CHECK,
            status: 'completed',
            conclusion: 'failure',
            app_id: DEFAULT_REQUIRED_APP_ID,
          },
        ]),
      });
      const mainStatus = getMainCiStatus({ gitFn: mockGit, ghFn: mockGh });
      expect(mainStatus.ok).toBe(false);
      expect(mainStatus.state).toBe('FAILURE');
    });

    it('permits launch ONLY when main check is verified GREEN', () => {
      const mockGit = () => ({ ok: true, stdout: 'green1234567890' });
      const mockGh = () => ({
        ok: true,
        stdout: JSON.stringify([
          {
            name: DEFAULT_REQUIRED_CHECK,
            status: 'completed',
            conclusion: 'success',
            app_id: DEFAULT_REQUIRED_APP_ID,
          },
        ]),
      });
      const mainStatus = getMainCiStatus({ gitFn: mockGit, ghFn: mockGh });
      expect(mainStatus.ok).toBe(true);
      expect(mainStatus.state).toBe('GREEN');
    });
  });

  describe('Finding 4: Exact-Head Check & Trusted App ID Binding', () => {
    it('correct name + correct app + success -> SUCCESS', () => {
      const mockGh = () => ({
        ok: true,
        stdout: JSON.stringify([
          {
            name: DEFAULT_REQUIRED_CHECK,
            status: 'completed',
            conclusion: 'success',
            app_id: DEFAULT_REQUIRED_APP_ID,
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

    it('correct name + wrong app -> UNTRUSTED (never SUCCESS)', () => {
      const mockGh = () => ({
        ok: true,
        stdout: JSON.stringify([
          {
            name: DEFAULT_REQUIRED_CHECK,
            status: 'completed',
            conclusion: 'success',
            app_id: 99999, // untrusted third-party app spoofing the check name
          },
        ]),
      });
      const status = getExactHeadCiStatus({
        sha: 'a1b2c3d4e5f6',
        ghFn: mockGh,
      });
      expect(status.ok).toBe(false);
      expect(status.state).toBe('UNTRUSTED');
      expect(status.reason).toContain('untrusted app');
    });

    it('duplicate same-name checks: trusted app is evaluated', () => {
      const mockGh = () => ({
        ok: true,
        stdout: JSON.stringify([
          {
            name: DEFAULT_REQUIRED_CHECK,
            status: 'completed',
            conclusion: 'failure',
            app_id: 99999, // untrusted
          },
          {
            name: DEFAULT_REQUIRED_CHECK,
            status: 'completed',
            conclusion: 'success',
            app_id: DEFAULT_REQUIRED_APP_ID, // trusted
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

    it('stale green SHA does not authorize newer PR HEAD', () => {
      const staleSha = 'stale11111111111111111111111111111111111';
      const newerSha = 'newer22222222222222222222222222222222222';
      const mockGh = (args: string[]) => {
        const endpoint = args[1] || '';
        if (endpoint.includes(staleSha)) {
          return {
            ok: true,
            stdout: JSON.stringify([
              {
                name: DEFAULT_REQUIRED_CHECK,
                status: 'completed',
                conclusion: 'success',
                app_id: DEFAULT_REQUIRED_APP_ID,
              },
            ]),
          };
        }
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: DEFAULT_REQUIRED_CHECK,
              status: 'in_progress',
              conclusion: null,
              app_id: DEFAULT_REQUIRED_APP_ID,
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

    it('missing SHA returns MISSING fail-closed', () => {
      const status = getExactHeadCiStatus({ sha: null });
      expect(status.ok).toBe(false);
      expect(status.state).toBe('MISSING');
    });
  });

  describe('Finding 3: CI Failure Incident Capsule & Ownership-Respecting Repair Routing', () => {
    const tmpDir = join(tmpdir(), 'foresift-ci-test-tmp');

    it('creates a deduplicated incident capsule on CI failure', () => {
      rmSync(tmpDir, { recursive: true, force: true });
      const mockGh = (args: string[]) => {
        if (args[0] === 'api') {
          return {
            ok: true,
            stdout: JSON.stringify([
              {
                name: DEFAULT_REQUIRED_CHECK,
                status: 'completed',
                conclusion: 'failure',
                app_id: DEFAULT_REQUIRED_APP_ID,
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

      const result1 = captureCiIncident({
        sha: 'testfailsha123',
        stateDir: tmpDir,
        ghFn: mockGh,
      });
      expect(result1).not.toBeNull();
      expect(result1!.deduplicated).toBe(false);
      expect(result1!.capsule.classification.category).toBe('FORMAT');
      expect(result1!.capsule.repairRoute.route).toBe('DETERMINISTIC_FORMAT');
      expect(result1!.capsule.repairRoute.needsAi).toBe(false);
      expect(existsSync(result1!.filePath)).toBe(true);

      // Second capture for same SHA is deduplicated and returns cached capsule
      const result2 = captureCiIncident({
        sha: 'testfailsha123',
        stateDir: tmpDir,
        ghFn: mockGh,
      });
      expect(result2).not.toBeNull();
      expect(result2!.deduplicated).toBe(true);
      expect(result2!.capsule.eventId).toBe(result1!.capsule.eventId);
    });

    it('routes FORMAT failure to deterministic formatter without AI', () => {
      const route = selectCiRepairRoute({ classification: 'FORMAT' });
      expect(route.route).toBe('DETERMINISTIC_FORMAT');
      expect(route.engine).toBe('FORMATTER');
      expect(route.role).toBe('mechanical');
      expect(route.needsAi).toBe(false);
    });

    it('routes INFRA failure to infrastructure wait without consuming AI turns', () => {
      const route = selectCiRepairRoute({ classification: 'INFRA' });
      expect(route.route).toBe('INFRASTRUCTURE_WAIT');
      expect(route.engine).toBe('NONE');
      expect(route.role).toBe('infra');
      expect(route.needsAi).toBe(false);
    });

    it('routes test-owned file failures to AGY test authority', () => {
      const route = selectCiRepairRoute({
        classification: 'TESTS',
        failedFiles: ['tests/acceptance/AC-001.spec.ts'],
      });
      expect(route.route).toBe('AGY_TEST_REPAIR');
      expect(route.engine).toBe('AGY');
      expect(route.role).toBe('test');
      expect(route.needsAi).toBe(true);
    });

    it('routes product code failures to Codex implementation repair under CODEX_AGY', () => {
      const route = selectCiRepairRoute({
        classification: 'TYPECHECK',
        executionProfile: 'CODEX_AGY',
        failedFiles: ['packages/persistence/src/index.ts'],
      });
      expect(route.route).toBe('CODEX_IMPLEMENTATION_REPAIR');
      expect(route.engine).toBe('CODEX');
      expect(route.role).toBe('implementation');
      expect(route.needsAi).toBe(true);
    });

    it('routes SPEC failure to maintainer control plane repair', () => {
      const route = selectCiRepairRoute({ classification: 'SPEC' });
      expect(route.route).toBe('SPEC_INTEGRITY_REPAIR');
      expect(route.engine).toBe('CLAUDE');
      expect(route.role).toBe('maintainer');
      expect(route.needsAi).toBe(true);
    });

    it('escalates to maintainer when repair attempts are exhausted', () => {
      const route = selectCiRepairRoute({
        classification: 'TESTS',
        attempts: 2,
        maxAttempts: 2,
      });
      expect(route.route).toBe('MAINTAINER_ESCALATION');
      expect(route.engine).toBe('CLAUDE');
      expect(route.action).toBe('BLOCKED_OPERATOR_REQUIRED');
      expect(route.needsAi).toBe(true);
    });
  });

  describe('Finding 2 & 5: Admin Elimination & Declaration Parity', () => {
    it('direct-main state whitelist permits only state files', () => {
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

      expect(validateDirectMainPushWhitelist(['packages/persistence/src/index.ts']).allowed).toBe(
        false,
      );
      expect(validateDirectMainPushWhitelist(['package.json']).allowed).toBe(false);
      expect(validateDirectMainPushWhitelist(['tests/acceptance/AC-001.spec.ts']).allowed).toBe(
        false,
      );
      expect(validateDirectMainPushWhitelist(['.github/workflows/ci.yml']).allowed).toBe(false);
    });

    it('package-land.mjs and workflows contain zero --admin merges', () => {
      const landerCode = readFileSync(
        join(root, 'scripts', 'automation', 'package-land.mjs'),
        'utf8',
      );
      expect(landerCode).not.toContain('--admin');
      expect(landerCode).toContain("sh('gh', ['pr', 'merge', prNum, '--squash'])");

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

    it('exports DEFAULT_REPO, DEFAULT_REQUIRED_APP_ID, and STATE_ONLY_WHITELIST', () => {
      expect(DEFAULT_REPO).toBe('quantm-zeus/foresift');
      expect(DEFAULT_REQUIRED_APP_ID).toBe(15368);
      expect(STATE_ONLY_WHITELIST.length).toBeGreaterThan(0);
    });

    it('classifyCiFailure accurately extracts failed files and classifies categories', () => {
      const log = `
$ prettier --check .
[warn] evidence/manifest.json
[warn] Code style issues found in 1 file. Run Prettier with --write to fix.
      `;
      const result = classifyCiFailure(log);
      expect(result.category).toBe('FORMAT');
      expect(result.repairable).toBe(true);
      expect(result.failedFiles).toContain('evidence/manifest.json');
    });

    it('auditGitHubProtection verifies required check, enforce_admins, and app id', () => {
      const audit = auditGitHubProtection();
      expect(audit.ok).toBe(true);
      expect(audit.enforceAdmins).toBe(true);
      expect(audit.strictChecks).toBe(true);
      expect(audit.checkFound).toBe(true);
      expect(audit.appIdMatches).toBe(true);
      expect(audit.expectedAppId).toBe(15368);
    });
  });
});
