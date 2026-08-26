#!/usr/bin/env node
// Deterministic Foresift verification gate.
//
//   pnpm foresift:gate --package <package-id>   # per-package gate
//   pnpm foresift:gate --milestone              # full repository verification (milestone audit / final gate)
//
// AI agents are never the final authority for verification success: this gate
// derives package-specific checks from version-controlled metadata
// (specs/implementation/current-milestone.json) and executes them
// deterministically. Fail-closed on any missing/invalid state.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  loadRoadmap,
  loadCurrentMilestone,
  validateRoadmap,
  validateMilestoneState,
  findPackage,
} from './schema.mjs';
import { throughputProfile } from './work-package-throughput-profile.mjs';
import { classifyCommand } from './verify-dedupe.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package') args.package = argv[++i];
    else if (a === '--milestone') args.milestone = true;
    else if (a === '--result-file') args.resultFile = argv[++i];
    else if (a !== '--') args._.push(a); // tolerate pnpm's forwarded `--` separator
  }
  return args;
}

// ── Structured per-check result manifest (task spec §9; V2 second pass) ──────
// OPT-IN via --result-file: when the flag is absent nothing changes for any
// existing caller (LEGACY lane included) — no file written, no output shifted.
// When present, every check is recorded with a stable CATEGORY so the bounded
// repair loop can plan TARGETED re-verification instead of re-running the
// whole gate. Written on failure AND on success; also written for pre-check
// blocks (invalid metadata) so "why did it fail" is always machine-readable.
const RESULT_SCHEMA = 'foresift/full-gate-result@1';
const gateChecks = [];
let gateStartedAt = new Date().toISOString();

function writeGateResult(passed, exitCode) {
  if (!args.resultFile) return;
  const failedCategories = [
    ...new Set(gateChecks.filter((c) => c.status !== 'PASS').map((c) => c.category)),
  ];
  try {
    writeFileSync(
      args.resultFile,
      JSON.stringify(
        {
          schema: RESULT_SCHEMA,
          packageId: args.package ?? null,
          passed,
          exitCode,
          failedCategories,
          checks: gateChecks,
          startedAt: gateStartedAt,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
  } catch {
    // Manifest writing must never change gate behavior or mask a real verdict.
  }
}

function run(cmd, label, category) {
  if (
    category === 'TESTS' &&
    (process.env.FORESIFT_TEST_AUTHORITY === '1' ||
      process.env.FORESIFT_TEST_COORDINATOR === '1') &&
    process.env.FORESIFT_ALLOW_HERMETIC_NESTED_FULL !== '1'
  ) {
    console.error(
      'NESTED_FULL_EXECUTION_BLOCKED: a test process may exercise gate semantics only against an explicitly marked hermetic fixture repository',
    );
    gateChecks.push({ label, category, command: cmd, status: 'FAIL' });
    writeGateResult(false, 86);
    process.exit(86);
  }
  console.log(`\n═══ GATE ▸ ${label}\n═══ $ ${cmd}`);
  const res = spawnSync(cmd, {
    shell: true,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    console.error(`\n✗ GATE FAILED at "${label}" (exit ${res.status})`);
    gateChecks.push({ label, category: category ?? 'UNKNOWN', command: cmd, status: 'FAIL' });
    writeGateResult(false, res.status ?? 1);
    process.exit(res.status ?? 1);
  }
  gateChecks.push({ label, category: category ?? 'UNKNOWN', command: cmd, status: 'PASS' });
  console.log(`✓ ${label} passed`);
}

const args = parseArgs(process.argv.slice(2));

if (args.milestone) {
  // Full applicable repository verification — used by milestone audit and as the final gate.
  run('pnpm spec:verify', 'authoritative spec integrity', 'SPEC');
  run('pnpm format:check', 'formatting', 'FORMAT');
  run('pnpm lint', 'lint', 'LINT');
  run('pnpm typecheck', 'TypeScript', 'TYPECHECK');
  run('pnpm test', 'full test suite', 'TESTS');
  writeGateResult(true, 0);
  console.log('\n✅ MILESTONE GATE PASSED');
  process.exit(0);
}

if (!args.package || args._.length > 0) {
  console.error(
    'usage: pnpm foresift:gate --package <package-id>   |   pnpm foresift:gate --milestone',
  );
  process.exit(2);
}

const roadmap = loadRoadmap();
const ms = loadCurrentMilestone();
for (const [name, errs] of [
  ['roadmap', validateRoadmap(roadmap)],
  ['current-milestone', ms ? validateMilestoneState(ms) : ['file missing']],
]) {
  if (errs.length) {
    console.error(`✗ GATE BLOCKED — invalid ${name}:\n  - ${errs.join('\n  - ')}`);
    writeGateResult(false, 2);
    process.exit(2);
  }
}
const pkg = findPackage(ms, args.package);
if (!pkg) {
  console.error(
    `✗ GATE BLOCKED — package "${args.package}" not in current milestone ${ms.milestoneId}`,
  );
  writeGateResult(false, 2);
  process.exit(2);
}

console.log(
  `FORESIFT PACKAGE GATE — ${ms.milestoneId}/${pkg.id} (risk ${pkg.risk}, requirements: ${pkg.requirementIds.length})`,
);

// Always enforce authoritative spec integrity first.
run('pnpm spec:verify', 'authoritative spec integrity', 'SPEC');

// CRITICAL/HIGH packages carry the broader repository verification required by the PRD.
if (pkg.risk === 'CRITICAL' || pkg.risk === 'HIGH') {
  run('pnpm format:check', 'formatting', 'FORMAT');
  run('pnpm lint', 'lint', 'LINT');
  run('pnpm typecheck', 'TypeScript', 'TYPECHECK');
  run('pnpm test', 'full test suite', 'TESTS');
} else {
  run('pnpm typecheck', 'TypeScript', 'TYPECHECK');
  run('pnpm test', 'test suite', 'TESTS');
}

// Package-specific deterministic verification from version-controlled metadata.
//
// LEGACY profile (g0-contracts-data-truth): every command executes exactly as
// before — this path is behaviorally frozen.
//
// OPTIMIZED profile: proven-only dedupe. The `pnpm test` above ran the ROOT
// authoritative root suite, which includes every test file repo-wide; a
// per-package filtered rerun is skipped ONLY when classifyCommand proves it
// re-executes nothing but those already-covered files. Absence of proof ⇒ the
// command runs.
const profile = throughputProfile(pkg.id);
if (profile === 'LEGACY') console.log('(LEGACY profile — dedupe disabled, every check executes)');
let skippedDuplicates = 0;
for (const cmd of pkg.verificationCommands) {
  if (/^\s*pnpm (verify|spec:verify)\s*$/.test(cmd)) continue; // already covered above
  if (profile === 'OPTIMIZED') {
    const verdict = classifyCommand(cmd, process.cwd());
    if (verdict.class === 'DUPLICATE_COVERED_BY_FULL_SUITE') {
      console.log(`\n═══ GATE ▸ duplicate skipped (PROVEN: ${verdict.reason})\n═══ $ ${cmd}`);
      skippedDuplicates++;
      continue;
    }
    if (verdict.class === 'UNIQUE_MANDATORY' && !/^\s*test -d /.test(cmd))
      console.log(`(unique-mandatory: ${verdict.reason})`);
  }
  run(cmd, `package check`, 'PACKAGE');
}
if (skippedDuplicates > 0)
  console.log(
    `\n▸ ${skippedDuplicates} package check(s) skipped as PROVEN duplicates of the full suite (${profile} profile).`,
  );

writeGateResult(true, 0);
console.log(`\n✅ PACKAGE GATE PASSED — ${pkg.id}`);
