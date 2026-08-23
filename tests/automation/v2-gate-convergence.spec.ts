// V2 second-pass regression coverage for PR C2 (task spec §8–§12, §23 items
// 20–32): structured FULL-gate result manifests, attestation-on-PASS-only,
// targeted post-failure verification planning, and the fail-closed convergence
// router. Two gate executions below are REAL end-to-end runs against this
// repository's actual state: the milestone gate is deterministically GREEN
// here (repo-wide checks only), while any package gate is deterministically
// RED at its package checks (product packages/* do not exist yet) — both
// directions of the manifest writer are therefore exercised against reality.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GATE_RESULT_FILE,
  attestationIdentity,
  parseFullGateResult,
} from '../../scripts/automation/package-full-gate.mjs';
import {
  extractFailingTestFiles,
  planTargetedChecks,
} from '../../scripts/automation/package-targeted-verify.mjs';
import { collectReviewOutcome } from '../../scripts/automation/review-outcome-collector.mjs';
import {
  DECISION_NOT_REQUIRED,
  DECISION_REQUIRED,
  decideConvergence,
  parseReviewVerdict,
} from '../../scripts/automation/convergence-router.mjs';

const SCRIPTS = join(import.meta.dirname, '..', '..', 'scripts', 'automation');
const REPO = process.cwd();

// The two REAL-gate tests below spawn foresift:gate, whose `pnpm test` stage
// re-runs THIS very file. The env sentinel marks that nested execution so the
// recursion terminates after exactly one level (the nested run skips the
// spawners; everything else still runs against reality).
const GATE_E2E_NESTED = 'FORESIFT_GATE_E2E_NESTED';
const itE2e = (name: string, fn: () => void, timeout?: number) => {
  if (process.env[GATE_E2E_NESTED] === '1') return; // nested run — see comment above
  it(name, fn, timeout);
};

let fx: string;
beforeAll(() => {
  fx = mkdtempSync(join(tmpdir(), 'foresift-v2-c2-'));
});
afterAll(() => {
  rmSync(fx, { recursive: true, force: true });
});

const art = (name: string) => {
  const d = join(fx, name);
  mkdirSync(d, { recursive: true });
  return d;
};

const manifestFixture = (over: Record<string, unknown> = {}) => ({
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

const verdictFixture = (over: Record<string, unknown> = {}) => ({
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

// ── §9: structured FULL-gate result manifests (REAL gate executions) ─────────
describe('V2 structured gate manifest (spec §9)', () => {
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
    240_000,
  );

  itE2e(
    'RED path: package gate fails at its package checks with a structured manifest and NO attestation',
    () => {
      const dir = art('gate-red');
      let code = 0;
      try {
        execFileSync(
          'node',
          [
            join(SCRIPTS, 'foresift-gate.mjs'),
            '--package',
            'g0-tool-core',
            '--result-file',
            join(dir, GATE_RESULT_FILE),
          ],
          {
            encoding: 'utf8',
            cwd: REPO,
            stdio: 'pipe',
            env: { ...process.env, [GATE_E2E_NESTED]: '1' },
          },
        );
      } catch (e) {
        code = (e as { status?: number }).status ?? -1;
      }
      expect(code).not.toBe(0); // product packages/* do not exist yet ⇒ deterministic red
      const m = parseFullGateResult(readFileSync(join(dir, GATE_RESULT_FILE), 'utf8'));
      expect(m?.passed).toBe(false);
      expect(m?.exitCode).toBe(code);
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

  it('parseFullGateResult rejects malformed/wrong-schema/shape-broken evidence (fail-closed)', () => {
    expect(parseFullGateResult('not json')).toBeNull();
    expect(parseFullGateResult('{}')).toBeNull();
    expect(
      parseFullGateResult(JSON.stringify({ schema: 'other@1', passed: true, checks: [] })),
    ).toBeNull();
    expect(
      parseFullGateResult(JSON.stringify({ schema: 'foresift/full-gate-result@1', checks: [] })),
    ).toBeNull();
    expect(
      parseFullGateResult(JSON.stringify({ schema: 'foresift/full-gate-result@1', passed: true })),
    ).toBeNull();
    expect(parseFullGateResult(null as unknown as string)).toBeNull();
  });
});

// ── §10: targeted verification planning ───────────────────────────────────────
describe('V2 targeted verification planning (spec §10)', () => {
  it('single FORMAT/LINT/TYPECHECK/SPEC failures route to exactly their own check', () => {
    for (const cat of ['FORMAT', 'LINT', 'TYPECHECK', 'SPEC'] as const) {
      const m = manifestFixture({
        failedCategories: [cat],
        checks: [{ label: cat, category: cat, command: 'cmd', status: 'FAIL' }],
      });
      const plan = planTargetedChecks({ manifest: m });
      expect(plan.mode).toBe('TARGETED');
      expect(plan.checks).toHaveLength(1);
    }
    const fmt = planTargetedChecks({
      manifest: manifestFixture({
        failedCategories: ['FORMAT'],
        checks: [{ label: 'f', category: 'FORMAT', command: 'x', status: 'FAIL' }],
      }),
    });
    expect(fmt.checks[0]?.command).toBe('pnpm format:check');
    const lint = planTargetedChecks({
      manifest: manifestFixture({
        failedCategories: ['LINT'],
        checks: [{ label: 'l', category: 'LINT', command: 'x', status: 'FAIL' }],
      }),
    });
    expect(lint.checks[0]?.command).toBe('pnpm lint');
    const tsc = planTargetedChecks({
      manifest: manifestFixture({
        failedCategories: ['TYPECHECK'],
        checks: [{ label: 't', category: 'TYPECHECK', command: 'x', status: 'FAIL' }],
      }),
    });
    expect(tsc.checks[0]?.command).toBe('pnpm typecheck');
    const spec = planTargetedChecks({
      manifest: manifestFixture({
        failedCategories: ['SPEC'],
        checks: [{ label: 's', category: 'SPEC', command: 'x', status: 'FAIL' }],
      }),
    });
    expect(spec.checks[0]?.command).toBe('pnpm spec:verify');
  });

  it('single PACKAGE failure re-runs the EXACT recorded commands verbatim', () => {
    const cmd = 'test -d packages/domain && pnpm --filter @foresift/domain test';
    const plan = planTargetedChecks({
      manifest: manifestFixture({
        failedCategories: ['PACKAGE'],
        checks: [{ label: 'package check', category: 'PACKAGE', command: cmd, status: 'FAIL' }],
      }),
    });
    expect(plan.mode).toBe('TARGETED');
    expect(plan.checks).toEqual([
      { label: expect.stringContaining('package check'), command: cmd },
    ]);
  });

  it('TESTS failure uses failing files from the gate log when identifiable, else the full suite', () => {
    const log = [
      'stdout noise',
      'FAIL  tests/automation/a.spec.ts > suite > case',
      ' ❯ tests/automation/b.test.ts (3 tests | 1 failed) 12ms',
      '✗ unrelated/not-a-test.txt',
      'FAIL  tests/gone-from-disk.spec.ts > x',
    ].join('\n');
    const exists = (p: string) => !p.includes('gone-from-disk');
    const plan = planTargetedChecks({
      manifest: manifestFixture({
        failedCategories: ['TESTS'],
        checks: [
          { label: 'full test suite', category: 'TESTS', command: 'pnpm test', status: 'FAIL' },
        ],
      }),
      gateLogText: log,
      exists,
    });
    expect(plan.mode).toBe('TARGETED');
    expect(plan.checks[0]?.command).toBe(
      'pnpm exec vitest run tests/automation/a.spec.ts tests/automation/b.test.ts',
    );
    const conservative = planTargetedChecks({
      manifest: manifestFixture({
        failedCategories: ['TESTS'],
        checks: [
          { label: 'full test suite', category: 'TESTS', command: 'pnpm test', status: 'FAIL' },
        ],
      }),
      gateLogText: '',
    });
    expect(conservative.checks[0]?.command).toBe('pnpm test');
  });

  it.each([
    [
      'multiple categories',
      manifestFixture({
        failedCategories: ['TYPECHECK', 'TESTS'],
        checks: [
          { label: 'TypeScript', category: 'TYPECHECK', command: 'pnpm typecheck', status: 'FAIL' },
          { label: 'full test suite', category: 'TESTS', command: 'pnpm test', status: 'FAIL' },
        ],
      }),
    ],
    [
      'unknown category',
      manifestFixture({
        failedCategories: ['WEIRD'],
        checks: [{ label: 'w', category: 'WEIRD', command: 'x', status: 'FAIL' }],
      }),
    ],
    ['missing manifest', null],
    // Malformed/wrong-schema evidence reaches the planner as null because the
    // executor always pre-parses through parseFullGateResult — model that here.
    ['malformed manifest', parseFullGateResult('{"hello":true}')],
    [
      'wrong schema',
      parseFullGateResult(
        JSON.stringify(manifestFixture({ schema: 'foresift/full-gate-result@0' })),
      ),
    ],
    [
      'PASS manifest in failure context',
      manifestFixture({ passed: true, failedCategories: [], checks: [] }),
    ],
    ['failure with zero failing rows', manifestFixture({ failedCategories: [], checks: [] })],
  ])('%s escalates to the FULL gate (fail-closed)', (_name, m) => {
    const plan = planTargetedChecks({ manifest: m as Record<string, unknown> | null });
    expect(plan.mode).toBe('ESCALATE_FULL');
    expect(plan.checks).toEqual([]);
    expect(plan.reason).toBeTruthy();
  });

  it('extractFailingTestFiles dedupes and only accepts existing files', () => {
    const files = extractFailingTestFiles(
      'FAIL  tests/a.spec.ts > x\nFAIL  tests/a.spec.ts > y\n ❯ tests/c.test.ts (1|0)',
      (p) => !p.includes('c.test'),
    );
    expect(files).toEqual(['tests/a.spec.ts']);
  });

  it('END-TO-END: executor runs ONLY the planned check and records a green verdict file', () => {
    const dir = art('targeted-green');
    writeFileSync(
      join(dir, GATE_RESULT_FILE),
      JSON.stringify(
        manifestFixture({
          failedCategories: ['TYPECHECK'],
          checks: [
            {
              label: 'TypeScript',
              category: 'TYPECHECK',
              command: 'pnpm typecheck',
              status: 'FAIL',
            },
            { label: 'full test suite', category: 'TESTS', command: 'pnpm test', status: 'PASS' },
          ],
        }),
      ),
    );
    const r = (() => {
      try {
        return {
          status: 0,
          out: execFileSync(
            'node',
            [
              join(SCRIPTS, 'package-targeted-verify.mjs'),
              '--manifest',
              join(dir, GATE_RESULT_FILE),
              '--artifacts-dir',
              dir,
            ],
            { encoding: 'utf8', cwd: REPO, stdio: 'pipe' },
          ),
        };
      } catch (e) {
        return { status: (e as { status?: number }).status ?? -1, out: '' };
      }
    })();
    expect(r.status).toBe(0);
    const rec = JSON.parse(readFileSync(join(dir, 'targeted-verify-result.json'), 'utf8'));
    expect(rec.schema).toBe('foresift/targeted-verify@1');
    expect(rec.mode).toBe('TARGETED');
    expect(rec.allGreen).toBe(true);
    expect(rec.checks.map((c: { command: string }) => c.command)).toEqual(['pnpm typecheck']);
  });

  it('END-TO-END: executor re-runs real red package commands and reports red (exit 1)', () => {
    const dir = art('targeted-red');
    const cmd = 'test -d packages/tool-core && pnpm --filter @foresift/tool-core test';
    writeFileSync(
      join(dir, GATE_RESULT_FILE),
      JSON.stringify(
        manifestFixture({
          packageId: 'g0-tool-core',
          failedCategories: ['PACKAGE'],
          checks: [{ label: 'package check', category: 'PACKAGE', command: cmd, status: 'FAIL' }],
        }),
      ),
    );
    let code = 0;
    try {
      execFileSync(
        'node',
        [
          join(SCRIPTS, 'package-targeted-verify.mjs'),
          '--manifest',
          join(dir, GATE_RESULT_FILE),
          '--artifacts-dir',
          dir,
        ],
        { encoding: 'utf8', cwd: REPO, stdio: 'pipe' },
      );
    } catch (e) {
      code = (e as { status?: number }).status ?? -1;
    }
    expect(code).toBe(1);
    const rec = JSON.parse(readFileSync(join(dir, 'targeted-verify-result.json'), 'utf8'));
    expect(rec.allGreen).toBe(false);
    expect(rec.checks[0]?.command).toBe(cmd);
  });

  it('END-TO-END: ambiguous evidence escalates (exit 3) without running any check', () => {
    const dir = art('targeted-escalated');
    writeFileSync(
      join(dir, GATE_RESULT_FILE),
      JSON.stringify(
        manifestFixture({
          failedCategories: ['LINT', 'TESTS'],
          checks: [
            { label: 'lint', category: 'LINT', command: 'pnpm lint', status: 'FAIL' },
            { label: 'full test suite', category: 'TESTS', command: 'pnpm test', status: 'FAIL' },
          ],
        }),
      ),
    );
    let code = 0;
    try {
      execFileSync(
        'node',
        [
          join(SCRIPTS, 'package-targeted-verify.mjs'),
          '--manifest',
          join(dir, GATE_RESULT_FILE),
          '--artifacts-dir',
          dir,
        ],
        { encoding: 'utf8', cwd: REPO, stdio: 'pipe' },
      );
    } catch (e) {
      code = (e as { status?: number }).status ?? -1;
    }
    expect(code).toBe(3);
    const rec = JSON.parse(readFileSync(join(dir, 'targeted-verify-result.json'), 'utf8'));
    expect(rec.mode).toBe('ESCALATE_FULL');
    expect(rec.checks).toEqual([]);
  });
});

// ── §11: deterministic convergence routing ────────────────────────────────────
describe('V2 convergence router decision core (spec §11)', () => {
  const head = 'a'.repeat(40);
  const clean = {
    currentHead: head,
    verdict: verdictFixture(),
    attestation: { present: true, drift: null },
    completeness: { complete: true },
  };

  it('ALL conditions hold ⇒ CONVERGENCE_NOT_REQUIRED with empty reasons', () => {
    const d = decideConvergence(clean);
    expect(d.decision).toBe(DECISION_NOT_REQUIRED);
    expect(d.reasons).toEqual([]);
  });

  it.each([
    [
      'CHANGES_REQUESTED verdict',
      { verdict: verdictFixture({ reviewDecision: 'CHANGES_REQUESTED' }) },
      /CHANGES_REQUESTED/,
    ],
    [
      'REVIEW_REQUIRED verdict',
      { verdict: verdictFixture({ reviewDecision: 'REVIEW_REQUIRED' }) },
      /not APPROVED/,
    ],
    [
      'unresolved threads',
      { verdict: verdictFixture({ unresolvedThreads: 3 }) },
      /3 unresolved review thread/,
    ],
    [
      'HEAD moved before review',
      { verdict: verdictFixture({ headAtReviewStart: 'b'.repeat(40) }) },
      /pre-review snapshot/,
    ],
    [
      'HEAD moved after review',
      { verdict: verdictFixture({ headAfterReview: 'b'.repeat(40) }) },
      /during or after review/,
    ],
    ['invalid verdict flag', { verdict: verdictFixture({ valid: false }) }, /marked invalid/],
    ['missing verdict', { verdict: null }, /missing or marked invalid/],
    [
      'no attestation',
      { attestation: { present: false, drift: null } },
      /no FULL-gate attestation/,
    ],
    ['attestation drift', { attestation: { present: true, drift: ['headSha'] } }, /drift: headSha/],
    [
      'implementation incomplete',
      { completeness: { complete: false } },
      /does not report complete/,
    ],
  ])('%s ⇒ CONVERGENCE_REQUIRED naming the cause', (_name, over, pattern) => {
    const d = decideConvergence({ ...clean, ...over });
    expect(d.decision).toBe(DECISION_REQUIRED);
    expect(d.reasons.join(' ')).toMatch(pattern);
  });

  it('multiple simultaneous gaps are ALL reported (forensics, not just the first)', () => {
    const d = decideConvergence({
      currentHead: head,
      verdict: null,
      attestation: { present: false, drift: null },
      completeness: { complete: false },
    });
    expect(d.reasons).toHaveLength(3);
  });

  it('parseReviewVerdict rejects unusable evidence; accepts valid records', () => {
    expect(parseReviewVerdict('junk')).toBeNull();
    expect(parseReviewVerdict('{}')).toBeNull();
    expect(parseReviewVerdict(JSON.stringify(verdictFixture({ schema: 'x@1' })))).toBeNull();
    expect(parseReviewVerdict(JSON.stringify(verdictFixture()))).not.toBeNull();
  });

  it('END-TO-END CLI: perfect review+attestation evidence but incomplete implementation ⇒ REQUIRED citing only completeness', () => {
    const dir = art('router-cli');
    const id = attestationIdentity({ packageId: 'g0-tool-core', repoRoot: REPO });
    writeFileSync(
      join(dir, 'review-verdict.json'),
      JSON.stringify(
        verdictFixture({
          headAtReviewStart: id.headSha,
          headAfterReview: id.headSha,
        }),
      ),
    );
    writeFileSync(
      join(dir, 'full-gate-attestation.json'),
      JSON.stringify({
        ...structuredClone(id),
        result: 'PASS',
        timestamp: '2026-08-23T00:00:00.000Z',
      }),
    );
    let code = 0;
    let out = '';
    try {
      out = execFileSync(
        'node',
        [
          join(SCRIPTS, 'convergence-router.mjs'),
          '--package',
          'g0-tool-core',
          '--artifacts-dir',
          dir,
          '--repo-root',
          REPO,
        ],
        { encoding: 'utf8', cwd: REPO, stdio: 'pipe' },
      );
    } catch (e) {
      code = (e as { status?: number; stdout?: string }).status ?? -1;
      out = (e as { stdout?: string }).stdout ?? '';
    }
    void out;
    expect(code).toBe(1); // specs/g0-tool-core does not exist ⇒ genuinely incomplete
    const decision = JSON.parse(readFileSync(join(dir, 'convergence-decision.json'), 'utf8'));
    expect(decision.decision).toBe(DECISION_REQUIRED);
    expect(decision.currentHead).toMatch(/^[0-9a-f]{40}$/);
    expect(decision.reasons).toHaveLength(1);
    expect(decision.reasons[0]).toMatch(/implementation-completeness/);
  });
});

// ── review-outcome collector: never crashes, degrades to invalid ─────────────
describe('V2 review-outcome collector degradation (spec §11)', () => {
  it('missing snapshot/pr-number ⇒ invalid verdict with reasons, no throw', () => {
    const dir = art('collector-empty');
    const repo = join(fx, 'collector-repo');
    mkdirSync(repo, { recursive: true });
    const v = collectReviewOutcome({ artifactsDir: dir, repoRoot: repo });
    expect(v.valid).toBe(false);
    expect(v.prNumber).toBeNull();
    expect(v.reviewDecision).toBeNull();
    expect(v.reasons.join(' ')).toMatch(/snapshot missing/);
    expect(v.reasons.join(' ')).toMatch(/\.pr-number artifact missing/);
  });

  it('valid local evidence with unreachable GitHub stays invalid-but-informative (fail-closed)', () => {
    const dir = art('collector-nogh');
    const repo = join(fx, 'collector-repo2');
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q', '--initial-branch=main', repo]);
    execFileSync('git', [
      '-C',
      repo,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'base',
    ]);
    writeFileSync(
      join(dir, '.review-head-snapshot.json'),
      JSON.stringify({ headSha: 'c'.repeat(40) }),
    );
    writeFileSync(join(dir, '.pr-number'), '424242\n');
    const v = collectReviewOutcome({ artifactsDir: dir, repoRoot: repo });
    expect(v.headAfterReview).toMatch(/^[0-9a-f]{40}$/);
    expect(v.prNumber).toBe(424242);
    // No real PR #424242 exists ⇒ GitHub evidence unobtainable ⇒ invalid.
    expect(v.valid).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/gh pr view failed|reviewDecision/);
  });
});
