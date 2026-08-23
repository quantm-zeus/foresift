#!/usr/bin/env node
// Deterministic Foresift verification gate.
//
//   pnpm foresift:gate --package <package-id>     # per-package gate
//   pnpm foresift:gate -- --package <package-id>  # same (pnpm forwards the separator)
//   pnpm foresift:gate --milestone                # full repository verification (milestone audit / final gate)
//
// AI agents are never the final authority for verification success: this gate
// derives package-specific checks from version-controlled metadata
// (specs/implementation/current-milestone.json) and executes them
// deterministically. Fail-closed on any missing/invalid state.

import { spawnSync } from 'node:child_process';
import {
  loadRoadmap,
  loadCurrentMilestone,
  validateRoadmap,
  validateMilestoneState,
  findPackage,
  parseGateArgs,
} from './schema.mjs';

function run(cmd, label) {
  console.log(`\n═══ GATE ▸ ${label}\n═══ $ ${cmd}`);
  const res = spawnSync(cmd, {
    shell: true,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    console.error(`\n✗ GATE FAILED at "${label}" (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
  console.log(`✓ ${label} passed`);
}

const args = parseGateArgs(process.argv.slice(2));

if (args.milestone) {
  // Full applicable repository verification — used by milestone audit and as the final gate.
  run('pnpm spec:verify', 'authoritative spec integrity');
  run('pnpm format:check', 'formatting');
  run('pnpm lint', 'lint');
  run('pnpm typecheck', 'TypeScript');
  run('pnpm test', 'full test suite');
  console.log('\n✅ MILESTONE GATE PASSED');
  process.exit(0);
}

if (!args.package || args._.length > 0) {
  console.error(
    'usage: pnpm foresift:gate -- --package <package-id>   |   pnpm foresift:gate -- --milestone',
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
    process.exit(2);
  }
}
const pkg = findPackage(ms, args.package);
if (!pkg) {
  console.error(
    `✗ GATE BLOCKED — package "${args.package}" not in current milestone ${ms.milestoneId}`,
  );
  process.exit(2);
}

console.log(
  `FORESIFT PACKAGE GATE — ${ms.milestoneId}/${pkg.id} (risk ${pkg.risk}, requirements: ${pkg.requirementIds.length})`,
);

// Always enforce authoritative spec integrity first.
run('pnpm spec:verify', 'authoritative spec integrity');

// CRITICAL/HIGH packages carry the broader repository verification required by the PRD.
if (pkg.risk === 'CRITICAL' || pkg.risk === 'HIGH') {
  run('pnpm format:check', 'formatting');
  run('pnpm lint', 'lint');
  run('pnpm typecheck', 'TypeScript');
  run('pnpm test', 'full test suite');
} else {
  run('pnpm typecheck', 'TypeScript');
  run('pnpm test', 'test suite');
}

// Package-specific deterministic verification from version-controlled metadata.
for (const cmd of pkg.verificationCommands) {
  if (/^\s*pnpm (verify|spec:verify)\s*$/.test(cmd)) continue; // already covered above
  run(cmd, `package check`);
}

console.log(`\n✅ PACKAGE GATE PASSED — ${pkg.id}`);
