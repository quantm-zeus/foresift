// V2 second-pass regression coverage for PR C2 (task spec §8–§12, §23 items
// 20–32): structured FULL-gate result manifests, attestation-on-PASS-only,
// targeted post-failure verification planning, and the fail-closed convergence
// router.
//
// This file holds the PURE decision/planner/parser matrices (unit tier — runs
// in milliseconds). The REAL end-to-end executions (two real gates, targeted
// executor CLI, router CLI, collector fixtures) live in the *-e2e-*.spec.ts
// integration files so they run concurrently and stay out of fast loops.

import { describe, expect, it } from 'bun:test';
import { parseFullGateResult } from '../../scripts/automation/package-full-gate.mjs';
import {
  extractFailingTestFiles,
  planTargetedChecks,
} from '../../scripts/automation/package-targeted-verify.mjs';
import {
  DECISION_NOT_REQUIRED,
  DECISION_REQUIRED,
  decideConvergence,
  parseReviewVerdict,
} from '../../scripts/automation/convergence-router.mjs';
import { manifestFixture, verdictFixture } from '../helpers/v2-fixtures.js';

describe('V2 structured gate manifest parsing (spec §9)', () => {
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
    const bunPlan = planTargetedChecks({
      manifest: manifestFixture({
        failedCategories: ['TESTS'],
        checks: [
          { label: 'full test suite', category: 'TESTS', command: 'pnpm test', status: 'FAIL' },
        ],
      }),
      gateLogText: log,
      exists,
      testAuthority: 'BUN_TEST',
    });
    expect(bunPlan.mode).toBe('TARGETED');
    expect(bunPlan.checks[0]?.command).toBe(
      'bun test --no-orphans --isolate --parallel=1 tests/automation/a.spec.ts tests/automation/b.test.ts',
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

  const escalationCases = [
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
  ] as const;
  for (const [name, m] of escalationCases) {
    it(`${name} escalates to the FULL gate (fail-closed)`, () => {
      const plan = planTargetedChecks({ manifest: m as Record<string, unknown> | null });
      expect(plan.mode).toBe('ESCALATE_FULL');
      expect(plan.checks).toEqual([]);
      expect(plan.reason).toBeTruthy();
    });
  }

  it('extractFailingTestFiles dedupes and only accepts existing files', () => {
    const files = extractFailingTestFiles(
      'FAIL  tests/a.spec.ts > x\nFAIL  tests/a.spec.ts > y\n ❯ tests/c.test.ts (1|0)',
      (p) => !p.includes('c.test'),
    );
    expect(files).toEqual(['tests/a.spec.ts']);
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

  const convergenceGapCases = [
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
  ] as const;
  for (const [name, over, pattern] of convergenceGapCases) {
    it(`${name} ⇒ CONVERGENCE_REQUIRED naming the cause`, () => {
      const d = decideConvergence({ ...clean, ...over });
      expect(d.decision).toBe(DECISION_REQUIRED);
      expect(d.reasons.join(' ')).toMatch(pattern);
    });
  }

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
});
