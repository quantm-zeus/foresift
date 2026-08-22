#!/usr/bin/env node
// Deterministic work-package preflight (runs inside the Archon worktree).
//
//   node scripts/automation/preflight.mjs --package <id> --branch foresift/<id>
//
// Fails closed (exit 1) unless every eligibility condition holds. Claude agents
// cannot override this: the workflow runs it as a bash gate before any AI node.

import { execSync, spawnSync } from 'node:child_process';
import {
  loadRoadmap,
  loadCurrentMilestone,
  validateRoadmap,
  validateMilestoneState,
  findPackage,
  packageEligible,
} from './schema.mjs';

function fail(msg) {
  console.error(`✗ PREFLIGHT FAILED — ${msg}`);
  process.exit(1);
}
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const args = {};
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--package') args.package = process.argv[i + 1];
  if (process.argv[i] === '--branch') args.branch = process.argv[i + 1];
}
if (!args.package || !args.branch) fail('usage: preflight.mjs --package <id> --branch <branch>');

console.log('PREFLIGHT ▸ toolchain');
for (const [label, cmd] of [
  ['git', 'git --version'],
  ['gh', 'gh --version'],
]) {
  try {
    sh(cmd);
  } catch {
    fail(`${label} is not available`);
  }
}
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor !== 24) fail(`Node 24.x required, running ${process.versions.node}`);
try {
  sh('pnpm --version');
} catch {
  fail('pnpm is not available on PATH');
}
try {
  sh('gh auth status');
} catch {
  fail('gh is not authenticated');
}

console.log('PREFLIGHT ▸ git remote / branch / worktree');
let remote;
try {
  remote = sh('git remote get-url origin');
} catch {
  fail('no origin remote');
}
if (!/foresift/i.test(remote)) fail(`unexpected origin remote: ${remote}`);
const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== args.branch) fail(`branch mismatch: on "${branch}", expected "${args.branch}"`);
const conflicts = sh('git diff --name-only --diff-filter=U || true');
if (conflicts) fail(`unresolved merge conflicts: ${conflicts.split('\n').join(', ')}`);

console.log('PREFLIGHT ▸ dependency installation');
{
  const res = spawnSync('pnpm install --frozen-lockfile', { shell: true, stdio: 'inherit' });
  if (res.status !== 0) fail('pnpm install --frozen-lockfile failed');
}

console.log('PREFLIGHT ▸ authoritative spec integrity');
{
  const res = spawnSync('pnpm spec:verify', { shell: true, stdio: 'inherit' });
  if (res.status !== 0) fail('authoritative spec integrity verification failed');
}

console.log('PREFLIGHT ▸ implementation state');
const roadmap = loadRoadmap();
const ms = loadCurrentMilestone();
const rmErrs = validateRoadmap(roadmap);
if (rmErrs.length) fail(`invalid roadmap: ${rmErrs.join('; ')}`);
if (!ms) fail('no current milestone planned — run foresift-milestone-control Mode A first');
const msErrs = validateMilestoneState(ms);
if (msErrs.length) fail(`invalid current-milestone: ${msErrs.join('; ')}`);
if (roadmap.currentMilestoneId && roadmap.currentMilestoneId !== ms.milestoneId)
  fail(
    `milestone mismatch: roadmap points at ${roadmap.currentMilestoneId}, milestone state is ${ms.milestoneId}`,
  );

const pkg = findPackage(ms, args.package);
if (!pkg) fail(`package ${args.package} does not exist in milestone ${ms.milestoneId}`);
const eligibility = packageEligible(ms, pkg);
// RUNNING is permitted: this preflight may be executing as part of that very run
// (the supervisor flips PENDING→RUNNING on main after launching the workflow).
const permitted =
  eligibility.eligible ||
  (pkg.status === 'RUNNING' &&
    (pkg.dependencies ?? []).every((d) => findPackage(ms, d)?.status === 'PROVEN'));
if (!permitted)
  fail(`package ${pkg.id} is not eligible: ${eligibility.reason} (status ${pkg.status})`);

console.log(
  `✓ PREFLIGHT PASSED — ${ms.milestoneId}/${pkg.id} (${pkg.risk}, deps: ${
    pkg.dependencies.length ? pkg.dependencies.join(', ') : 'none'
  })`,
);
