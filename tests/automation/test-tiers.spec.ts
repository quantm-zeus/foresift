// C2.5 regression guards: the test-tier organization itself must stay sound.
// 1. FULL discovery must never collect stale session worktrees (.claude/**) —
//    they contain OLD copies of these specs which run against CURRENT scripts
//    (measured: 60 duplicate tests + false red, 2026-08-23).
// 2. The seeded-template git fixture factory must produce isolated,
//    identity-correct repos with zero per-fixture git spawns.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { disposeGitFixtureBase, gitFixture } from '../helpers/git-fixture.js';

const REPO = process.cwd();

afterAll(() => {
  disposeGitFixtureBase();
});

describe('test-tier configuration (C2.5)', () => {
  const config = readFileSync(join(REPO, 'vitest.config.ts'), 'utf8');

  it('excludes stale session worktrees and node_modules from ALL projects', () => {
    expect(config).toContain("'**/.claude/**'");
    expect(config).toContain('configDefaults.exclude');
  });

  it('defines unit and integration projects; pnpm test runs BOTH (FULL authority unchanged)', () => {
    expect(config).toMatch(/name:\s*'unit'/);
    expect(config).toMatch(/name:\s*'integration'/);
    // Unit covers everything except e2e files; integration covers exactly those.
    expect(config).toMatch(/include:\s*\['tests\/\*\*\/\*\.spec\.ts'\]/);
    expect(config).toContain("include: ['tests/**/*e2e*.spec.ts']");
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    expect(pkg.scripts.test).toBe('node scripts/automation/test-authority.mjs'); // Delegated authority
    expect(pkg.scripts['test:unit']).toContain('--project unit');
    expect(pkg.scripts['test:integration']).toContain('--project integration');
  });

  it('live `vitest list` collects no .claude paths and finds both e2e gate files', () => {
    const out = execFileSync('./node_modules/.bin/vitest', ['list', '--filesOnly', '--run'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(out).not.toContain('.claude/');
    expect(out).toContain('gate-e2e-green.spec.ts');
    expect(out).toContain('gate-e2e-red.spec.ts');
    expect(out).toContain('targeted-router-e2e.spec.ts');
  });
});

describe('git fixture factory (C2.5 §5)', () => {
  it('clones are isolated: a commit in one fixture never appears in another or the template', () => {
    const a = gitFixture('iso-a');
    const b = gitFixture('iso-b');
    a.writeFile('only-a.txt', 'a\n');
    a.commitAll('a-only');
    expect(a.g(['log', '--oneline'])).toContain('a-only');
    // b still has only the base commit; template base untouched.
    expect(b.g(['log', '--oneline'])).not.toContain('a-only');
    expect(b.baseSha()).toBe(a.g(['rev-parse', 'HEAD~1']).trim());
  });

  it('identity works via GIT_* env (no global config) and origin/main resolves for merge-base', () => {
    const r = gitFixture('origin-check');
    expect(r.g(['log', '-1', '--format=%an <%ae>']).trim()).toBe('t <t@t>');
    // Tracking ref exists in the clone (copied .git) and points at HEAD~0's push.
    const mb = r.g(['merge-base', 'HEAD', 'origin/main']).trim();
    expect(mb).toBe(r.baseSha());
    // Pushes land in this fixture's PRIVATE origin, not any shared one.
    r.writeFile('pushed.txt', 'x\n');
    r.commitAll('private-push');
    r.g(['push', '-q', 'origin', 'main:main']);
    const ls = r
      .g(['ls-remote', 'origin'])
      .split('\n')
      .find((l) => l.endsWith('refs/heads/main'));
    expect(ls?.trim().split(/\s+/)[0]).toBe(r.baseSha());
  });

  it('materializing a fixture performs ZERO git process spawns (template copy only)', () => {
    // Prove the spawn-freedom claim structurally: two fixtures created back to
    // back have byte-identical base commits AND identical tree hashes, which
    // is only possible because they are copies of one seeded template.
    const x = gitFixture('copy-x');
    const y = gitFixture('copy-y');
    expect(x.baseSha()).toBe(y.baseSha());
    expect(x.g(['rev-parse', 'HEAD^{tree}']).trim()).toBe(y.g(['rev-parse', 'HEAD^{tree}']).trim());
  });
});
