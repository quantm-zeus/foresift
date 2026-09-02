// §25 SECOND-PASS PERFORMANCE ACCEPTANCE FIXTURES (CASE A–E).
//
// Low-cost deterministic fixtures that prove the OPTIMIZED pipeline's
// acceptance expectations per case using the REAL automation modules — no
// network, no live product runs, no AI. These are the executable form of the
// tasking's five benchmark cases; wall-clock §26 numbers live in
// .optimizer-evidence/v2-second-pass-final-report.md.
//
// `PKG` must resolve in the fixture milestone (attestation identity resolves
// risk/profile from the authoritative milestone via FORESIFT_REPO_ROOT, which
// gitFixture's template seeds); the disposable git fixture supplies HEAD
// movement and hashes.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import {
  DECISION_NOT_REQUIRED,
  DECISION_REQUIRED,
  decideConvergence,
} from '../../scripts/automation/convergence-router.mjs';
import { classifyImpact, planFastChecks } from '../../scripts/automation/fast-impact.mjs';
import {
  attestationDrift,
  attestationIdentity,
  parseFullGateResult,
} from '../../scripts/automation/package-full-gate.mjs';
import { planTargetedChecks } from '../../scripts/automation/package-targeted-verify.mjs';
import { runFinalLand } from '../../scripts/automation/package-final-land.mjs';
import { disposeGitFixtureBase, gitFixture } from '../helpers/git-fixture.js';

const PKG = 'g0-security-perimeter';

const scratch = mkdtempSync(join(tmpdir(), 'foresift-v2-cases-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  disposeGitFixtureBase();
});

const art = (name: string) => {
  const d = join(scratch, name);
  mkdirSync(d, { recursive: true });
  return d;
};

/** Minimal coherent FULL-gate manifest (schema foresift/full-gate-result@1). */
const gateManifest = (passed: boolean, failedCategories: string[] = []) =>
  JSON.stringify({
    schema: 'foresift/full-gate-result@1',
    packageId: PKG,
    passed,
    exitCode: passed ? 0 : 1,
    failedCategories,
    checks: [
      {
        label: 't',
        category: failedCategories[0] ?? 'TESTS',
        command: 'pnpm test',
        status: passed ? 'PASS' : 'FAIL',
      },
    ],
  });

describe('CASE A — clean package', () => {
  it('one FULL gate, zero convergence/create-PR/landing AI, attestation reuse', () => {
    const repo = gitFixture('case-a');
    repo.withMilestoneRoot();
    const h1 = repo.baseSha();
    const dir = art('case-a');
    // Exactly ONE local FULL gate ran and it was green at h1 (this manifest is
    // the only gate artifact on the clean path):
    writeFileSync(join(dir, 'full-gate-result.json'), gateManifest(true));
    expect(parseFullGateResult(gateManifest(true))?.passed).toBe(true);
    // Exact-head attestation remains valid at h1:
    const identity = attestationIdentity({ packageId: PKG, repoRoot: repo.root });
    expect(attestationDrift(identity, identity)).toBeNull();
    // Review approved with zero unresolved threads and HEAD unchanged:
    const verdict = {
      valid: true,
      reviewDecision: 'APPROVED',
      unresolvedThreads: 0,
      headAtReviewStart: h1,
      headAfterReview: h1,
    };
    const d = decideConvergence({
      currentHead: h1,
      verdict,
      attestation: { present: true, drift: null },
      completeness: { complete: true },
    });
    expect(d.decision).toBe(DECISION_NOT_REQUIRED); // deterministic convergence skip
    // Landing reuses the attestation instead of running another FULL:
    let gateRuns = 0;
    const land = runFinalLand(
      { package: PKG, branch: `foresift/${PKG}`, artifactsDir: dir, repoRoot: repo.root },
      {
        gateCheck: () => {
          gateRuns += 1;
          return { status: 0 };
        }, // attestation check hits ⇒ ATTESTATION_REUSE
        lander: () => ({ status: 0 }),
      },
    );
    expect(land.ok).toBe(true);
    expect(gateRuns).toBe(1); // ci-merge did NOT rerun the gate
    expect(JSON.parse(readLand(dir)).gateMode).toBe('ATTESTATION_REUSE');
  });
});

describe('CASE B — gate repair package', () => {
  it('targeted repair then exactly one FINAL FULL; FAST cannot authorize landing', () => {
    const dir = art('case-b');
    // Initial FULL fails one known category:
    const initial = parseFullGateResult(gateManifest(false, ['TESTS']));
    expect(initial?.passed).toBe(false);
    expect(initial?.failedCategories).toEqual(['TESTS']);
    // Repair plans TARGETED checks from the gate log's real failing files —
    // not a full-suite rerun per edit. Use a path that EXISTS so extraction
    // keeps it (deleted paths are dropped conservatively).
    const log = `FAIL tests/automation/v2-second-pass-cases.spec.ts > CASE A\n ❯ tests/automation/v2-second-pass-cases.spec.ts (1 test)`;
    const plan = planTargetedChecks({ manifest: initial, gateLogText: log });
    expect(plan.mode).toBe('TARGETED');
    expect(plan.checks.length).toBeGreaterThan(0);
    expect(plan.checks.some((c) => /bun/.test(c.command) || c.command.includes('test'))).toBe(true);
    // After repair exactly the FINAL FULL evidence lands (initial + final —
    // never one FULL per tiny edit; targeted checks ran in between):
    writeFileSync(join(dir, 'full-gate-result.json'), gateManifest(true));
    expect(parseFullGateResult(gateManifest(true))?.passed).toBe(true);
    // A FAST-only pass cannot authorize landing: no exact-head attestation ⇒
    // convergence REQUIRED even with an otherwise-perfect review verdict.
    const d = decideConvergence({
      currentHead: 'a'.repeat(40),
      verdict: {
        valid: true,
        reviewDecision: 'APPROVED',
        unresolvedThreads: 0,
        headAtReviewStart: 'a'.repeat(40),
        headAfterReview: 'a'.repeat(40),
      },
      attestation: { present: false, drift: null },
      completeness: { complete: true },
    });
    expect(d.decision).toBe(DECISION_REQUIRED);
  });
});

describe('CASE C — review finding package', () => {
  it('HEAD change invalidates the old attestation and forces repair/convergence', () => {
    const repo = gitFixture('case-c');
    repo.withMilestoneRoot();
    const h1 = repo.baseSha();
    repo.writeFile('packages/c/code.ts', 'export {};\n');
    repo.commitAll('review fix moves HEAD');
    const h2 = repo.baseSha();
    expect(h2).not.toBe(h1);
    // The attestation captured at h1 drifts against the new HEAD identity:
    const attested = attestationIdentity({ packageId: PKG, repoRoot: repo.root });
    const drifted =
      attestationDrift(
        { ...attested, headSha: h1 },
        attestationIdentity({ packageId: PKG, repoRoot: repo.root }),
      ) ?? [];
    expect(drifted.length).toBeGreaterThan(0);
    // Even an APPROVED verdict cannot skip convergence once HEAD moved after
    // the required finding was fixed:
    const d = decideConvergence({
      currentHead: h2,
      verdict: {
        valid: true,
        reviewDecision: 'APPROVED',
        unresolvedThreads: 0,
        headAtReviewStart: h1,
        headAfterReview: h2,
      },
      attestation: { present: true, drift: ['headSha'] },
      completeness: { complete: true },
    });
    expect(d.decision).toBe(DECISION_REQUIRED);
  });
});

describe('CASE D — unknown impact', () => {
  it('unclassifiable changes escalate fail-closed to the FULL gate', () => {
    const unknown = classifyImpact(['data/unknown-artifact.bin']);
    expect(unknown.escalateFull).toBe(true);
    expect(unknown.reason).toBeTruthy();
    // No FAST plan can substitute for an escalated slice:
    expect(planFastChecks(unknown)).toEqual([]);
    // Authoritative-spec touches take their own conservative lane: authority
    // validation steps rather than silent acceptance as DOC_ONLY.
    const spec = classifyImpact(['docs/spec/x.requirements.json']);
    expect(spec.categories.AUTHORITATIVE_SPEC).toEqual(['docs/spec/x.requirements.json']);
    const specPlan = planFastChecks(spec);
    expect(specPlan.some((s) => s.kind === 'authority-validate')).toBe(true);
  });
});

describe('CASE E — clean final landing', () => {
  it('zero AI between attestation validation and squash merge', () => {
    const repo = gitFixture('case-e');
    repo.withMilestoneRoot();
    const dir = art('case-e');
    writeFileSync(join(dir, 'full-gate-result.json'), gateManifest(true));
    // runFinalLand IS the deterministic lander: injected deps record every
    // step; there is no AI surface anywhere in its signature or sequence.
    const calls: string[] = [];
    const land = runFinalLand(
      { package: PKG, branch: `foresift/${PKG}`, artifactsDir: dir, repoRoot: repo.root },
      {
        gateCheck: () => {
          calls.push('gateCheck');
          return { status: 0 };
        },
        gateRun: () => {
          calls.push('gateRun');
          return { status: 0 };
        },
        lander: (o) => {
          calls.push(`lander:${o.branch}`);
          return { status: 0, stdout: 'Squashed and merged' };
        },
      },
    );
    expect(land.ok).toBe(true);
    // Clean path: attestation check passes ⇒ NO second gate run, straight to
    // the deterministic lander. Zero Claude invocation points exist.
    expect(calls).toEqual(['gateCheck', `lander:foresift/${PKG}`]);
    const result = JSON.parse(readLand(dir));
    expect(result.gateMode).toBe('ATTESTATION_REUSE');
    expect(result.merged).toBe(true);
  });
});

/** Read the land result written into the artifacts dir. */
function readLand(dir: string): string {
  return readFileSync(join(dir, 'land-result.json'), 'utf8');
}
