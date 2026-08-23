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
// Impact-aware checks (fast-impact.mjs): JS/TS → eslint + vitest related +
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
      case 'vitest-related': {
        const existing = step.files.filter((f) => existsSync(join(repoRoot, f)) || existsSync(f));
        if (existing.length === 0) {
          if (step.database) {
            // Deleted-only DB slice: nothing remains to relate against — the
            // safe signal is the full suite (schema drift can break anything).
            console.log('FAST ▸ database paths all absent — escalating to full test suite');
            escalatedToFullSuite = true;
            results.push({ escalated: true, reason: 'database-deleted' });
          }
          break;
        }
        const r = sh(repoRoot, './node_modules/.bin/vitest', ['related', ...existing, '--run']);
        results.push(r);
        if (
          step.database &&
          r.result === 'PASS' &&
          /No test files found/i.test(r.stdoutTail ?? '')
        ) {
          console.log('FAST ▸ no persistence tests relate to the schema change — full suite');
          escalatedToFullSuite = true;
          results.push({ escalated: true, reason: 'database-no-related-tests' });
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
        if (tests.length > 0)
          results.push(sh(repoRoot, './node_modules/.bin/vitest', ['run', ...tests]));
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
