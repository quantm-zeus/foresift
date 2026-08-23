#!/usr/bin/env node
// DETERMINISTIC final landing for one Foresift work package (V2 task spec
// §14). The OPTIMIZED lane's clean path invokes this INSTEAD of an AI merge
// agent; ZERO Claude invocations on success:
//
//   1. establish exact-head FULL-gate evidence — reuse a still-valid
//      attestation (--check); only on a miss run ONE FULL gate (--run);
//   2. compose the PR body deterministically (package-create-pr.mjs);
//   3. hand off to the mechanical lander (package-land.mjs: push → discover/
//      create PR → pinned-head CI wait → squash-merge).
//
//   node scripts/automation/package-final-land.mjs \
//     --package <id> --branch <branch> --artifacts-dir <dir> [--deadline-s <s>]
//
// EVERY terminal path persists $ARTIFACTS_DIR/land-result.json. Exit codes:
//   0 — merged:true recorded (the ONLY exit the workflow accepts as landed)
//   4 — mechanical landing did not complete ⇒ bounded AI fallback may run,
//       and MUST end by re-running THIS script (never merge around it)
//   2 — usage error

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { composePrBody, PR_NUMBER_FILE } from './package-create-pr.mjs';

export const LAND_RESULT_SCHEMA = 'foresift/final-land@1';
export const LAND_RESULT_FILE = 'land-result.json';

const here = dirname(fileURLToPath(import.meta.url));
const FULL_GATE_TOOL = join(here, 'package-full-gate.mjs');
const LANDER_TOOL = join(here, 'package-land.mjs');

function parseArgs(argv) {
  const a = {};
  // Iterate to the END: a truncated/trailing flag must never be silently dropped.
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--package':
        a.package = argv[++i];
        break;
      case '--branch':
        a.branch = argv[++i];
        break;
      case '--artifacts-dir':
        a.artifactsDir = argv[++i];
        break;
      case '--repo-root':
        a.repoRoot = argv[++i];
        break;
      case '--deadline-s':
        a.deadlineS = argv[++i];
        break;
    }
  }
  return a;
}

/**
 * Pure-ish core with injectable process runners so tests can prove every
 * route without executing gates, git, or gh. deps:
 *   gateCheck({packageId, artifactsDir}) → {status}
 *   gateRun({packageId, artifactsDir})   → {status}   (FULL execution)
 *   lander({branch,title,bodyFile,deadlineS}) → {status, stdout}
 */
export function runFinalLand(a, deps = {}) {
  const {
    gateCheck = ({ packageId, artifactsDir }) =>
      spawnSync(
        process.execPath,
        [FULL_GATE_TOOL, '--check', '--package', packageId, '--artifacts-dir', artifactsDir],
        { encoding: 'utf8' },
      ),
    gateRun = ({ packageId, artifactsDir }) =>
      spawnSync(
        process.execPath,
        [FULL_GATE_TOOL, '--run', '--package', packageId, '--artifacts-dir', artifactsDir],
        { encoding: 'utf8' },
      ),
    lander = ({ branch, title, bodyFile, deadlineS }) =>
      spawnSync(
        process.execPath,
        [
          LANDER_TOOL,
          '--branch',
          branch,
          '--title',
          title,
          '--body-file',
          bodyFile,
          ...(deadlineS ? ['--deadline-s', String(deadlineS)] : []),
        ],
        { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
      ),
    now = () => new Date().toISOString(),
  } = deps;

  if (!a.package || !a.branch || !a.artifactsDir) {
    console.error(
      'usage: package-final-land.mjs --package <id> --branch <branch> --artifacts-dir <dir> [--deadline-s <s>]',
    );
    process.exitCode = 2;
    return { ok: false, usage: true };
  }

  const artifactsDir = resolve(a.artifactsDir);
  const record = (merged, reason, extra = {}) => {
    const result = {
      schema: LAND_RESULT_SCHEMA,
      merged,
      reason: reason ?? null,
      packageId: a.package,
      branch: a.branch,
      prNumber: null,
      ...extra,
      timestamp: now(),
    };
    try {
      // .pr-number may exist from the deterministic create-pr step.
      result.prNumber =
        Number(readFileSync(join(artifactsDir, PR_NUMBER_FILE), 'utf8').trim()) || null;
    } catch {
      /* upstream PR creation record absent — the lander discovers/creates anyway */
    }
    try {
      writeFileSync(join(artifactsDir, LAND_RESULT_FILE), JSON.stringify(result, null, 2) + '\n');
    } catch {
      /* artifacts failures must not mask the exit verdict */
    }
    return result;
  };

  // ── 1. exact-head FULL-gate evidence (reuse-first; at most ONE fresh FULL) ──
  let gateMode = 'ATTESTATION_REUSE';
  if (gateCheck({ packageId: a.package, artifactsDir }).status !== 0) {
    gateMode = 'FULL_RUN';
    console.log('LAND ▸ no valid attestation — running one final FULL gate');
    const run = gateRun({ packageId: a.package, artifactsDir });
    if (run.status !== 0) {
      console.error(`LAND ▸ FULL gate RED (exit ${run.status}) — landing refused`);
      record(false, 'full-gate-red', { gateMode, fullGateExitCode: run.status ?? -1 });
      process.exitCode = 4;
      return { ok: false };
    }
  }

  // ── 2. deterministic PR body ────────────────────────────────────────────────
  const { title, body } = composePrBody({
    packageId: a.package,
    repoRoot: a.repoRoot ? resolve(a.repoRoot) : undefined,
    artifactsDir,
  });
  const bodyFile = join(artifactsDir, 'pr-body.md');
  try {
    writeFileSync(bodyFile, body);
  } catch (e) {
    record(false, 'body-write-failed', { gateMode });
    console.error(`LAND ▸ could not write ${bodyFile}: ${e.message}`);
    process.exitCode = 4;
    return { ok: false };
  }

  // ── 3. mechanical lander (push → CI wait at pinned head → squash-merge) ────
  const res = lander({ branch: a.branch, title, bodyFile, deadlineS: a.deadlineS });
  const out = String(res.stdout ?? '');
  // Mirror the lander transcript into our log stream for artifact capture.
  if (out.trim()) console.log(out.trimEnd());
  if (res.status !== 0) {
    let childReason = 'lander-exit-' + (res.status ?? -1);
    try {
      const m = /\{\s*"merged"\s*:\s*false[\s\S]*\}$/.exec(out.trim());
      if (m) childReason = JSON.parse(m[0]).reason ?? childReason;
    } catch {
      /* keep generic reason */
    }
    console.error(
      `LAND ▸ mechanical landing failed (${childReason}) — routing to bounded fallback`,
    );
    record(false, childReason, { gateMode, landerExitCode: res.status ?? -1 });
    process.exitCode = 4;
    return { ok: false };
  }
  let prNumber;
  try {
    const m = /\{\s*"merged"\s*:\s*true[\s\S]*\}$/.exec(out.trim());
    prNumber = m ? JSON.parse(m[0]).pr : undefined;
  } catch {
    /* pr number is cosmetic here; merged verdict comes from exit 0 */
  }
  console.log(`LAND ▸ MERGED mechanically (${gateMode})`);
  record(true, null, { gateMode, prNumber: prNumber ?? undefined });
  process.exitCode = 0;
  return { ok: true };
}

function main() {
  runFinalLand(parseArgs(process.argv.slice(2)));
}

const invokedDirectly = process.argv[1]?.endsWith('package-final-land.mjs');
if (invokedDirectly) main();
