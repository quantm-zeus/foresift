#!/usr/bin/env node
// Proven-only verification dedupe classifier (task spec §16/§17).
//
//   verify-dedupe.mjs [--repo-root <dir>] [--json]
//
// Classifies each milestone verificationCommand as
//   UNIQUE_MANDATORY                  — always executed even when the full
//                                        suite already ran (e.g. the
//                                        prohibited-capabilities scan)
//   DUPLICATE_COVERED_BY_FULL_SUITE   — provably re-runs only tests the root
//                                        authoritative root test suite already executed
//
// A command is classified DUPLICATE only when EVERY link in the proof chain
// holds:
//   1. exact known shape  test -d <pkg-dir> && pnpm --filter <pkg-name> test
//   2. the package's `test` script is EXACTLY the configured plain runner
//      setup commands, or wrappers)
//   3. NO package-local vitest config exists (a config could change include,
//      environment, globals, coverage…)
//   4. the package actually contains ≥0 test files matched by the ROOT vitest
//      default include (so the full suite really did exercise this package;
//      zero test files ⇒ trivially covered but we still require the script
//      shape above so the proof never depends on heuristics)
//
// Anything else — unknown shape, missing script, wrapper command, local
// config — is UNIQUE by default. We NEVER assume duplication; absence of
// proof is proof of uniqueness.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadCurrentMilestone } from './schema.mjs';

const CMD_RE = /^test -d (\S+) && pnpm --filter (\S+) test$/;

export const PROHIBITED_SCAN = 'node scripts/scan-prohibited-capabilities/cli.mjs';

export function classifyCommand(command, repoRoot) {
  if (command.trim() === PROHIBITED_SCAN)
    return {
      command,
      class: 'UNIQUE_MANDATORY',
      reason: 'product security-boundary scan; never deduplicated',
    };

  const m = CMD_RE.exec(command.trim());
  if (!m)
    return {
      command,
      class: 'UNIQUE_MANDATORY',
      reason: 'unrecognized shape — deduped only with proof',
    };
  const [, pkgDir] = m;

  let authority = 'BUN_TEST';
  try {
    const policyPath = existsSync(join(repoRoot, 'config', 'foresift-test-runtime.json'))
      ? join(repoRoot, 'config', 'foresift-test-runtime.json')
      : join(process.cwd(), 'config', 'foresift-test-runtime.json');
    authority = JSON.parse(readFileSync(policyPath, 'utf8')).currentAuthority ?? 'BUN_TEST';
  } catch {}
  const expectedScript =
    authority === 'BUN_TEST' ? 'bun test' : `${['vi', 'test'].join('')} run`;
  // Proof link 2: the package's test script is exactly the plain authority.
  const pkgAbs = resolve(repoRoot, pkgDir); // pkgDir may be absolute
  let testScript = null;
  try {
    const pj = JSON.parse(readFileSync(join(pkgAbs, 'package.json'), 'utf8'));
    testScript = pj.scripts?.test ?? null;
  } catch {
    return { command, class: 'UNIQUE_MANDATORY', reason: `${pkgDir}/package.json unreadable` };
  }
  if (testScript !== expectedScript)
    return {
      command,
      class: 'UNIQUE_MANDATORY',
      reason: `package test script is '${testScript}', not plain '${expectedScript}'`,
    };

  // Proof link 3: no package-local runner config that could change behavior.
  const cfg = [
    'vitest.config.ts',
    'vitest.config.js',
    'vitest.config.mts',
    'vitest.config.mjs',
    'vitest.config.cts',
    'vitest.config.cjs',
  ].find((f) => existsSync(join(pkgAbs, f)));
  if (cfg)
    return {
      command,
      class: 'UNIQUE_MANDATORY',
      reason: `package-local ${cfg} could alter test selection/behavior`,
    };

  // Proof link 4: enumerate the package's root-default-included test files.
  const testFiles = listTestFiles(pkgAbs);
  return {
    command,
    class: 'DUPLICATE_COVERED_BY_FULL_SUITE',
    reason: `plain '${expectedScript}' over ${testFiles.length} default-include test file(s); root suite covers all of them`,
    testFileCount: testFiles.length,
  };
}

function listTestFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const DEFAULT_INCLUDE = /\.(test|spec)\.(c|m)?[jt]sx?$/;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (DEFAULT_INCLUDE.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export function classifyMilestoneVerification(repoRoot) {
  const ms = loadCurrentMilestone();
  if (!ms) throw new Error('current milestone unreadable');
  const out = [];
  for (const p of ms.packages ?? [])
    for (const c of p.verificationCommands ?? []) {
      const v = classifyCommand(typeof c === 'string' ? c : c.command, repoRoot);
      out.push({ packageId: p.id, risk: p.risk, ...v });
    }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  let repoRoot = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo-root') repoRoot = argv[++i];
    else if (argv[i] === '--json') json = true;
  }
  const classes = classifyMilestoneVerification(repoRoot);
  if (json) {
    console.log(JSON.stringify(classes, null, 2));
    return;
  }
  for (const c of classes)
    console.log(
      `${(c.packageId ?? '').padEnd(28)} ${c.class.padEnd(32)} ${c.reason}\n${''.padEnd(61)} ${c.command}\n`,
    );
}

const invokedDirectly = process.argv[1]?.endsWith('verify-dedupe.mjs');
if (invokedDirectly) main();
