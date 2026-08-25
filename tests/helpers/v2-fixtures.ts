// Shared fixtures for the V2 gate/convergence suites. Pure data + tiny env
// helpers only — no process spawning at import time (this module is imported
// by the fast unit-tier spec too).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, type TestContext } from 'vitest';

export const SCRIPTS = join(import.meta.dirname, '..', '..', 'scripts', 'automation');
export const REPO = process.cwd();

/** Per-file scratch dir with named artifact subdirs; caller cleans up in afterAll. */
export function makeScratch(prefix: string) {
  const fx = mkdtempSync(join(tmpdir(), prefix));
  const art = (name: string) => {
    const d = join(fx, name);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const cleanup = () => rmSync(fx, { recursive: true, force: true });
  return { fx, art, cleanup };
}

export const manifestFixture = (over: Record<string, unknown> = {}) => ({
  schema: 'foresift/full-gate-result@1',
  packageId: 'p',
  passed: false,
  exitCode: 1,
  failedCategories: [],
  checks: [
    {
      label: 'authoritative spec integrity',
      category: 'SPEC',
      command: 'pnpm spec:verify',
      status: 'PASS',
    },
    { label: 'formatting', category: 'FORMAT', command: 'pnpm format:check', status: 'PASS' },
    { label: 'lint', category: 'LINT', command: 'pnpm lint', status: 'PASS' },
    { label: 'TypeScript', category: 'TYPECHECK', command: 'pnpm typecheck', status: 'PASS' },
    { label: 'full test suite', category: 'TESTS', command: 'pnpm test', status: 'PASS' },
    {
      label: 'package check',
      category: 'PACKAGE',
      command: 'pnpm --filter x test',
      status: 'FAIL',
    },
  ],
  timestamp: '2026-08-23T00:00:00.000Z',
  ...over,
});

export const verdictFixture = (over: Record<string, unknown> = {}) => ({
  schema: 'foresift/review-verdict@1',
  valid: true,
  prNumber: 42,
  prUrl: 'https://github.com/x/y/pull/42',
  reviewDecision: 'APPROVED',
  unresolvedThreads: 0,
  headAtReviewStart: 'a'.repeat(40),
  headAfterReview: 'a'.repeat(40),
  collectedAt: '2026-08-23T00:00:00.000Z',
  reasons: [],
  ...over,
});

// The REAL-gate E2E tests spawn foresift:gate, whose `pnpm test` stage re-runs
// THIS very suite. The env sentinel marks that nested execution so the
// recursion terminates after exactly one level (the nested run skips the
// spawners; everything else still runs against reality).
export const GATE_E2E_NESTED = 'FORESIFT_GATE_E2E_NESTED';
export const itE2e = (
  name: string,
  fn: (ctx: TestContext) => void | Promise<void>,
  timeout?: number,
) => {
  // Nested run — see comment above. Register SKIPped (not absent): since C2.5
  // these spawners live in dedicated files, and Vitest fails a suite that
  // ends up with zero tests.
  if (process.env[GATE_E2E_NESTED] === '1') return it.skip(name, fn, timeout);
  it(name, fn, timeout);
};

/**
 * Milestone-derived targets for the REAL-gate fixtures. Pinning a package id
 * (originally g0-tool-core) expires the moment that package lands, so both
 * fixtures now advance down the manifest exactly like the gate's own
 * first-failing-check semantics:
 *   - `redGatePkg`: the first package (declared order) with a verification
 *     command whose `test -d` target does not exist yet ⇒ its package gate is
 *     deterministically RED at that check.
 *   - `absentSpecPkg`: the first package whose `specs/<id>/` directory does
 *     not exist ⇒ its implementation is deterministically INCOMPLETE for the
 *     convergence router regardless of checkbox state.
 * Returns null when nothing qualifies (milestone fully landed); the fixtures
 * skip themselves rather than asserting against a vanished scenario.
 */
export function unlandedFixturePackages(): {
  redGatePkg: string;
  absentSpecPkg: string;
} | null {
  const ms = JSON.parse(
    readFileSync(join(REPO, 'specs', 'implementation', 'current-milestone.json'), 'utf8'),
  ) as { packages?: Array<{ id: string; verificationCommands?: string[] }> };
  const packages = ms.packages ?? [];
  const redGatePkg = packages.find((p) =>
    (p.verificationCommands ?? []).some((cmd) => {
      const target = /^test -d (\S+) &&/.exec(cmd)?.[1];
      return target != null && !existsSync(join(REPO, target));
    }),
  )?.id;
  const absentSpecPkg = packages.find((p) => !existsSync(join(REPO, 'specs', p.id)))?.id;
  if (!redGatePkg || !absentSpecPkg) return null;
  return { redGatePkg, absentSpecPkg };
}

/** Run a node CLI capturing exit code without throwing (for red-path tests). */
export function tryNode(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', args, {
      encoding: 'utf8',
      cwd: opts.cwd ?? REPO,
      stdio: 'pipe',
      env: opts.env ?? process.env,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}
