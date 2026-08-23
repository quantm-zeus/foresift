#!/usr/bin/env node
// FAST verification tier (task spec §13).
//
//   package-fast-verify.mjs --package <id> --artifacts-dir <dir>
//                          (--file <path> ... | --from-checkpoint)
//
// Runs, in order:
//   1. pnpm spec:verify                      (always — cheap, mandatory)
//   2. eslint on the touched files           (targeted)
//   3. vitest related <files>                (targeted tests touching them)
//
// Fail-closed rule: if the caller supplies NO usable touched source file, FAST
// refuses to guess and runs the FULL test suite instead — a fast pass is never
// earned by forgetting to say what changed.
//
// A FAST result NEVER writes a full-gate attestation and NEVER authorizes a
// merge (spec rules F/G). It exists only to give the implementation loop a
// seconds-not-minutes signal between slices.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { CHECKPOINT_FILE } from './package-checkpoint.mjs';

const CODE_EXT = /\.(m|c)?[jt]sx?$/;

/** Deterministic touched-file selection: absolute paths, code files only,
 *  existing files only, de-duplicated order-stable. */
export function selectFiles(candidates) {
  return [
    ...new Set(
      candidates
        .filter((f) => typeof f === 'string' && f.length > 0)
        .map((f) => (isAbsolute(f) ? f : resolve(f)))
        .filter((f) => CODE_EXT.test(f) && existsSync(f)),
    ),
  ];
}

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
      case '--from-checkpoint':
        a.fromCheckpoint = true;
        break;
    }
  }
  return a;
}

function run(repoRoot, cmd, args, opts = {}) {
  const label = [cmd, ...args].join(' ');
  console.log(`FAST ▸ ${label}`);
  try {
    execFileSync(cmd, args, {
      cwd: repoRoot,
      stdio: ['ignore', opts.pipe ? 'pipe' : 'inherit', 'inherit'],
    });
    return { command: label, result: 'PASS' };
  } catch {
    return { command: label, result: 'FAIL' };
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.package || !a.artifactsDir) {
    console.error(
      'usage: package-fast-verify.mjs --package <id> --artifacts-dir <dir> (--file <path> ... | --from-checkpoint)',
    );
    process.exit(2);
  }
  const repoRoot = a.repoRoot ?? process.cwd();
  let candidates = [...a.files];
  if (a.fromCheckpoint) {
    const cp = JSON.parse(readFileSync(join(a.artifactsDir, CHECKPOINT_FILE), 'utf8'));
    if (cp.packageId !== a.package) throw new Error('checkpoint belongs to another package');
    candidates.push(...(cp.filesTouched ?? []));
  }
  const files = selectFiles(candidates);

  const results = [];
  results.push(run(repoRoot, 'pnpm', ['spec:verify']));
  if (files.length === 0) {
    // Fail closed: unknown scope ⇒ full test suite.
    console.log('FAST ▸ no usable touched source files — escalating to FULL test suite');
    results.push({ escalated: true });
    results.push(run(repoRoot, 'pnpm', ['test']));
  } else {
    results.push(run(repoRoot, './node_modules/.bin/eslint', [...files]));
    results.push(
      run(repoRoot, './node_modules/.bin/vitest', ['related', ...files, '--run'], { pipe: false }),
    );
  }

  const failed = results.some((r) => r.result === 'FAIL');
  const summary = {
    schema: 'foresift/fast-verify@1',
    packageId: a.package,
    tier: 'FAST',
    mergeAuthorized: false,
    filesChecked: files,
    escalatedToFullSuite: results.some((r) => r.escalated),
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
if (invokedDirectly) main();
