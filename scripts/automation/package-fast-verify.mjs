#!/usr/bin/env node
// FAST verification tier (V2 task spec §7; supersedes the JS-only §13 tier).
//
//   package-fast-verify.mjs --package <id> --artifacts-dir <dir>
//     (--from-git [--base <ref>] | --file <path> ...)   # scope inputs
//
// Scope resolution (git evidence is authoritative; agent hints are additive):
//   --from-git   changed paths = <base>..HEAD commits + working tree
//                (added/modified/deleted/renamed/untracked), derived by
//                slice-changeset.mjs. Base: explicit --base > valid checkpoint
//                headSha > merge-base(HEAD, origin/main) > fail-closed.
//   --file       agent-supplied hint paths (still classified, never trusted
//                as complete).
// Both may be combined; the union is classified.
//
// Impact-aware checks (fast-impact.mjs): JS/TS → eslint + affected-test graph +
// typecheck; SQL/migrations → related persistence tests (escalating to the
// full suite when NOTHING relates, preserving the old fail-closed behavior of
// non-JS slices); authoritative spec → authority validators + conformance
// tests; .archon/.claude control plane → format + `archon validate workflows`;
// docs → format check; root/unknown impact → FULL test-suite escalation.
//
// Fail-closed rule: with NO usable scope at all, FAST runs the FULL test suite
// rather than earning a pass by forgetting to say what changed.
//
// A FAST result NEVER writes a full-gate attestation and NEVER authorizes a
// merge (spec rules F/G). It exists only to give the implementation loop a
// seconds-not-minutes signal between slices.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CHECKPOINT_FILE, validateCheckpoint } from './package-checkpoint.mjs';
import { resolveSliceChangeset } from './slice-changeset.mjs';
import { classifyImpact, planFastChecks } from './fast-impact.mjs';
import { repositorySourcePaths, selectAffectedTests } from './bun-affected-tests.mjs';
import { buildBunTestPlan, runBunTestPlan } from './bun-test-coordinator.mjs';
import { analyzeTestFile } from './bun-migration-manifest.mjs';

const TEST_RUNTIME_POLICY = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', 'config', 'foresift-test-runtime.json'),
    'utf8',
  ),
);
const BUN_MANIFEST = join(
  import.meta.dirname,
  '..',
  '..',
  'evidence',
  'bun-migration',
  'bun-migration-manifest.json',
);

function parseArgs(argv) {
  const a = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--package':
        a.package = argv[++i];
        break;
      case '--artifacts-dir':
        a.artifactsDir = argv[++i];
        break;
      case '--repo-root':
        a.repoRoot = argv[++i];
        break;
      case '--file':
        a.files.push(argv[++i]);
        break;
      case '--from-git':
        a.fromGit = true;
        break;
      case '--base':
        a.base = argv[++i];
        break;
    }
  }
  return a;
}

/** Base ref for --from-git: explicit > VALID checkpoint headSha > merge-base.
 *  An invalid/stale checkpoint must NOT pin the base (its HEAD claim cannot be
 *  trusted); fall through to merge-base. */
export function resolveFastBase({ repoRoot, packageId, artifactsDir, base }) {
  if (base) return { baseRef: base, source: 'explicit' };
  try {
    const cp = JSON.parse(readFileSync(join(artifactsDir, CHECKPOINT_FILE), 'utf8'));
    if (
      cp.packageId === packageId &&
      typeof cp.headSha === 'string' &&
      validateCheckpoint(cp, { packageId, headSha: cp.headSha }).valid
    ) {
      return { baseRef: cp.headSha, source: 'checkpoint' };
    }
  } catch {
    /* absent/unreadable checkpoint — fall through */
  }
  try {
    const mb = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    return { baseRef: mb, source: 'merge-base' };
  } catch {
    return { baseRef: null, source: 'unknown' };
  }
}

/**
 * The `vitest related` step of a FAST plan, extracted for testability.
 *
 * Paths are ABSOLUTIZED before invocation: `vitest related` silently matches
 * nothing for bare repo-relative arguments ("No test files found", exit 0),
 * and git changesets naturally yield repo-relative paths — passing them raw
 * reported FAST green while running zero tests (measured 2026-08-23, C2.5).
 * Likewise, a PASS whose output says no test files were found means NO
 * targeted evidence exists for the slice ⇒ the caller must escalate to the
 * full suite (fail-closed), whatever the category.
 *
 * Returns { logs, result?, escalateReason? }; injectable `sh` keeps this
 * unit-testable without spawning vitest.
 */
export function runAffectedTestsStep(step, deps = {}) {
  const { repoRoot, sh: shFn = sh } = deps;
  const logs = [];
  const selection = selectAffectedTests({
    root: repoRoot,
    changedPaths: step.files,
    allPaths: repositorySourcePaths(repoRoot),
  });
  if (!selection.ok) {
    logs.push(`FAST ▸ ${selection.reason} — escalating to full suite`);
    return { logs, selection, escalateReason: selection.reason };
  }
  if (shFn !== sh) {
    const cmd =
      TEST_RUNTIME_POLICY.currentAuthority === 'BUN_TEST' ? 'bun' : './node_modules/.bin/vitest';
    const args = ['run', ...selection.tests];
    const result = shFn(repoRoot, cmd, args);
    return { logs, selection, result };
  }
  if (TEST_RUNTIME_POLICY.currentAuthority === 'BUN_TEST') {
    const manifest = JSON.parse(readFileSync(BUN_MANIFEST, 'utf8'));
    const inventoried = new Set(manifest.files.map((entry) => entry.path));
    for (const path of selection.tests) {
      if (!inventoried.has(path)) manifest.files.push(analyzeTestFile(repoRoot, path));
    }
    const plan = buildBunTestPlan(manifest, TEST_RUNTIME_POLICY, selection.tests);
    const evidence = runBunTestPlan({ root: repoRoot, plan, policy: TEST_RUNTIME_POLICY });
    return {
      logs,
      selection,
      result: {
        command: `bun affected (${selection.tests.length} file(s))`,
        result: evidence.ok ? 'PASS' : 'FAIL',
        evidence,
      },
    };
  }
  const result = shFn(repoRoot, './node_modules/.bin/vitest', ['run', ...selection.tests]);
  return { logs, selection, result };
}

// Historical export retained only for imported V4 callers; behavior is the
// deterministic graph selector and never invokes `vitest related`.
export const runVitestRelatedStep = runAffectedTestsStep;

function sh(repoRoot, cmd, args, opts = {}) {
  const label = [cmd, ...args].join(' ');
  console.log(`FAST ▸ ${label}`);
  let stdout = '';
  try {
    stdout = execFileSync(cmd, args, {
      cwd: repoRoot,
      stdio: ['ignore', opts.pipe ? 'pipe' : 'inherit', 'inherit'],
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      command: label,
      result: 'PASS',
      ...(opts.pipe ? { stdoutTail: stdout.slice(-4000) } : {}),
    };
  } catch (err) {
    if (opts.pipe) stdout = String(err.stdout ?? '');
    return {
      command: label,
      result: 'FAIL',
      ...(opts.pipe ? { stdoutTail: stdout.slice(-4000) } : {}),
    };
  }
}

/** In-process deterministic authority validation (spec-conformance category). */
function authorityValidate() {
  // Imported lazily so pure consumers (tests importing this module for helpers)
  // don't need repo state present.
  return import('./schema.mjs').then((m) => {
    const reasons = [];
    try {
      const roadmap = m.loadRoadmap();
      reasons.push(...m.validateRoadmap(roadmap));
    } catch (e) {
      reasons.push(`roadmap unreadable: ${String(e?.message ?? e).slice(0, 120)}`);
    }
    try {
      const ms = m.loadCurrentMilestone();
      if (!ms) reasons.push('current-milestone missing');
      else reasons.push(...m.validateMilestoneState(ms));
    } catch (e) {
      reasons.push(`current-milestone unreadable: ${String(e?.message ?? e).slice(0, 120)}`);
    }
    return reasons;
  });
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.package || !a.artifactsDir || !(a.fromGit || a.files.length > 0)) {
    console.error(
      'usage: package-fast-verify.mjs --package <id> --artifacts-dir <dir> (--from-git [--base <ref>] | --file <path> ...)',
    );
    process.exit(2);
  }
  const repoRoot = a.repoRoot ?? process.cwd();

  // ── Scope resolution ────────────────────────────────────────────────────────
  let changeset = null;
  if (a.fromGit) {
    const baseInfo = resolveFastBase({
      repoRoot,
      packageId: a.package,
      artifactsDir: a.artifactsDir,
      base: a.base,
    });
    if (!baseInfo.baseRef) {
      console.log('FAST ▸ no resolvable slice base — escalating to FULL verification');
      changeset = { unknown: true, reasons: ['no resolvable base'], files: [] };
    } else {
      changeset = resolveSliceChangeset({ repoRoot, baseRef: baseInfo.baseRef });
      changeset.baseSource = baseInfo.source;
      console.log(
        `FAST ▸ git scope: base=${changeset.baseRef.slice(0, 10)} (${baseInfo.source}), ` +
          `${changeset.files.length} changed path(s)`,
      );
    }
  }

  const candidatePaths = [
    ...(changeset?.files ?? []).map((f) => f.path),
    ...a.files.map((f) => resolve(f)),
  ];

  // ── Classification & plan ───────────────────────────────────────────────────
  const classification = classifyImpact(candidatePaths);
  const plan = classification.escalateFull ? [] : planFastChecks(classification);

  const results = [];
  let escalatedToFullSuite = classification.escalateFull;
  let ranFullSuite = false;
  const runFullSuiteOnce = () => {
    if (!ranFullSuite) {
      results.push(sh(repoRoot, 'pnpm', ['test']));
      ranFullSuite = true;
    }
  };

  results.push(sh(repoRoot, 'pnpm', ['spec:verify'])); // cheap, mandatory, always

  if (classification.escalateFull) {
    console.log(`FAST ▸ ${classification.reason} — escalating to FULL verification`);
    results.push({ escalated: true, reason: classification.reason });
  } else if (candidatePaths.length === 0 && !a.fromGit) {
    // Explicit file mode with nothing usable: old fail-closed rule applies.
    console.log('FAST ▸ no usable touched source files — escalating to FULL test suite');
    escalatedToFullSuite = true;
    results.push({ escalated: true });
  }

  for (const step of plan) {
    switch (step.kind) {
      case 'eslint': {
        const existing = step.files.filter((f) => existsSync(f));
        if (existing.length > 0) results.push(sh(repoRoot, './node_modules/.bin/eslint', existing));
        break;
      }
      case 'affected-tests': {
        const out = runAffectedTestsStep(step, { repoRoot });
        for (const line of out.logs ?? []) console.log(line);
        if (out.result) results.push(out.result);
        if (out.selection)
          results.push({
            command: 'deterministic affected-test selection',
            result: out.selection.ok ? 'PASS' : 'ESCALATED',
            evidence: out.selection,
          });
        if (out.escalateReason) {
          escalatedToFullSuite = true;
          results.push({ escalated: true, reason: out.escalateReason });
        }
        break;
      }
      case 'typecheck':
        results.push(sh(repoRoot, 'pnpm', ['typecheck']));
        break;
      case 'authority-validate': {
        const reasons = await authorityValidate();
        results.push({
          command: 'authority-validate (roadmap + current-milestone validators)',
          result: reasons.length === 0 ? 'PASS' : 'FAIL',
          ...(reasons.length ? { reasons } : {}),
        });
        break;
      }
      case 'conformance-tests': {
        const tests = [
          'tests/automation/control-plane.spec.ts',
          'tests/spec-verify.spec.ts',
        ].filter((t) => existsSync(join(repoRoot, t)));
        if (tests.length > 0) {
          if (TEST_RUNTIME_POLICY.currentAuthority === 'BUN_TEST')
            results.push(sh(repoRoot, 'bun', ['test', '--parallel=1', ...tests]));
          else results.push(sh(repoRoot, './node_modules/.bin/vitest', ['run', ...tests]));
        }
        break;
      }
      case 'format-check': {
        const existing = step.files.filter((f) => existsSync(f));
        if (existing.length > 0)
          results.push(sh(repoRoot, './node_modules/.bin/prettier', ['--check', ...existing]));
        break;
      }
      case 'archon-validate':
        results.push(sh(repoRoot, 'archon', ['validate', 'workflows']));
        break;
      default:
        // Unknown plan step: fail closed.
        escalatedToFullSuite = true;
        results.push({ escalated: true, reason: `unplanned check kind '${step.kind}'` });
    }
  }

  if (escalatedToFullSuite) runFullSuiteOnce();

  const failed = results.some((r) => r.result === 'FAIL');
  const summary = {
    schema: 'foresift/fast-verify@2',
    packageId: a.package,
    tier: 'FAST',
    mergeAuthorized: false,
    scope: {
      fromGit: Boolean(a.fromGit),
      baseSource: changeset?.baseSource ?? null,
      baseRef: changeset?.baseRef ?? null,
      changedFiles: changeset?.files ?? [],
      changesetUnknown: Boolean(changeset?.unknown),
    },
    classification,
    planKinds: plan.map((p) => p.kind),
    escalatedToFullSuite,
    filesChecked: candidatePaths,
    results,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(
    join(a.artifactsDir, 'fast-verify-result.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  console.log(
    failed ? '\n❌ FAST VERIFY FAILED' : '\n✅ FAST VERIFY PASSED (never merge-authorizing)',
  );
  process.exit(failed ? 1 : 0);
}

const invokedDirectly = process.argv[1]?.endsWith('package-fast-verify.mjs');
if (invokedDirectly)
  main().catch((err) => {
    console.error(String(err?.stack ?? err));
    process.exit(1);
  });
