// Mid-weight END-TO-END executions (integration tier): targeted-verify
// executor CLI, convergence-router CLI, and the review-outcome collector's
// fixture-repo degradation paths. Split from the real-gate files so all
// integration files run CONCURRENTLY (C2.5: 36s serial → ~20s wall).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  GATE_RESULT_FILE,
  attestationIdentity,
} from '../../scripts/automation/package-full-gate.mjs';
import { collectReviewOutcome } from '../../scripts/automation/review-outcome-collector.mjs';
import { DECISION_REQUIRED } from '../../scripts/automation/convergence-router.mjs';
import {
  REPO,
  SCRIPTS,
  makeScratch,
  manifestFixture,
  tryNode,
  unlandedFixturePackages,
  verdictFixture,
} from '../helpers/v2-fixtures.js';

const { fx, art, cleanup } = makeScratch('foresift-v2-c2-mid-');
afterAll(cleanup);

// The incomplete-implementation target advances down the manifest as packages
// land (originally g0-tool-core, whose own landing expired that pin).
const unlanded = unlandedFixturePackages();

describe('V2 targeted executor END-TO-END (spec §10)', () => {
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
    const r = tryNode([
      join(SCRIPTS, 'package-targeted-verify.mjs'),
      '--manifest',
      join(dir, GATE_RESULT_FILE),
      '--artifacts-dir',
      dir,
    ]);
    expect(r.status).toBe(0);
    const rec = JSON.parse(readFileSync(join(dir, 'targeted-verify-result.json'), 'utf8'));
    expect(rec.schema).toBe('foresift/targeted-verify@1');
    expect(rec.mode).toBe('TARGETED');
    expect(rec.allGreen).toBe(true);
    expect(rec.checks.map((c: { command: string }) => c.command)).toEqual(['pnpm typecheck']);
  }, 120_000);

  it('END-TO-END: executor re-runs real red package commands and reports red (exit 1)', () => {
    const dir = art('targeted-red');
    // A never-existing target keeps this deterministically red forever — the
    // original pin (packages/tool-core) expired when that package landed.
    const cmd =
      'test -d packages/__no_such_target__ && pnpm --filter @foresift/__no_such_target__ test';
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
    const r = tryNode([
      join(SCRIPTS, 'package-targeted-verify.mjs'),
      '--manifest',
      join(dir, GATE_RESULT_FILE),
      '--artifacts-dir',
      dir,
    ]);
    expect(r.status).toBe(1);
    const rec = JSON.parse(readFileSync(join(dir, 'targeted-verify-result.json'), 'utf8'));
    expect(rec.allGreen).toBe(false);
    expect(rec.checks[0]?.command).toBe(cmd);
  }, 60_000);

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
    const r = tryNode([
      join(SCRIPTS, 'package-targeted-verify.mjs'),
      '--manifest',
      join(dir, GATE_RESULT_FILE),
      '--artifacts-dir',
      dir,
    ]);
    expect(r.status).toBe(3);
    const rec = JSON.parse(readFileSync(join(dir, 'targeted-verify-result.json'), 'utf8'));
    expect(rec.mode).toBe('ESCALATE_FULL');
    expect(rec.checks).toEqual([]);
  });
});

describe('V2 convergence router CLI END-TO-END (spec §11)', () => {
  it('perfect review+attestation evidence but incomplete implementation ⇒ REQUIRED citing only completeness', (ctx) => {
    if (!unlanded)
      return ctx.skip(
        'every declared package has a specs directory — no deterministic incompleteness remains',
      );
    const dir = art('router-cli');
    const id = attestationIdentity({ packageId: unlanded.absentSpecPkg, repoRoot: REPO });
    writeFileSync(
      join(dir, 'review-verdict.json'),
      JSON.stringify(
        verdictFixture({ headAtReviewStart: id.headSha, headAfterReview: id.headSha }),
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
    const r = tryNode([
      join(SCRIPTS, 'convergence-router.mjs'),
      '--package',
      unlanded.absentSpecPkg,
      '--artifacts-dir',
      dir,
      '--repo-root',
      REPO,
    ]);
    // specs/<absentSpecPkg> does not exist ⇒ genuinely incomplete.
    expect(r.status).toBe(1);
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
  }, 60_000);
});
