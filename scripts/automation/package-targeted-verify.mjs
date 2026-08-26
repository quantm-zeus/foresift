#!/usr/bin/env node
// TARGETED post-failure verification for the bounded repair/convergence loops
// (V2 task spec §10). Instead of re-running the whole FULL gate after every
// repair edit, this tool reads the structured gate manifest
// ($ARTIFACTS_DIR/full-gate-result.json, written by foresift:gate) and re-runs
// ONLY the failed category's check — or the exact recorded package commands.
//
//   node scripts/automation/package-targeted-verify.mjs \
//     --manifest <full-gate-result.json> --artifacts-dir <dir> [--gate-log <gate-log.txt>]
//
// Exit codes (the workflow routes on these):
//   0 — every planned targeted check PASSED (caller may run the final FULL gate)
//   1 — a targeted check is still RED (repair must continue; no FULL gate yet)
//   3 — ESCALATED: evidence missing/malformed/ambiguous ⇒ run the FULL gate
//
// Fail-closed direction: ANY doubt (no manifest, wrong schema, multiple failed
// categories, unknown category, PASS-manifest in a failure context) escalates
// to the FULL gate. Targeted checks NEVER authorize merging — only a FULL-gate
// attestation does.

import { spawnSync } from 'node:child_process';
import { existsSync as fsExists, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseFullGateResult } from './package-full-gate.mjs';

export const TARGETED_SCHEMA = 'foresift/targeted-verify@1';
export const TARGETED_RESULT_FILE = 'targeted-verify-result.json';

/** Deterministic command per single-category failure (task spec §10). */
export const CATEGORY_COMMANDS = {
  SPEC: 'pnpm spec:verify',
  FORMAT: 'pnpm format:check',
  LINT: 'pnpm lint',
  TYPECHECK: 'pnpm typecheck',
};
const KNOWN_CATEGORIES = new Set([...Object.keys(CATEGORY_COMMANDS), 'TESTS', 'PACKAGE']);

/**
 * Extract failing test file paths from a vitest transcript (the gate log).
 * Conservative: only paths matching vitest's FAIL / per-file summary shapes,
 * deduplicated, and only when the file exists on disk right now.
 */
export function extractFailingTestFiles(logText, exists = fsExists, cwd = process.cwd()) {
  if (!logText || typeof logText !== 'string') return [];
  const out = new Set();
  const re =
    /\bFAIL\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)|[❯✗×]\s*(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s*\(/g;
  let m;
  while ((m = re.exec(logText)) !== null) {
    const p = m[1] ?? m[2];
    if (!p) continue;
    try {
      if (exists(resolve(cwd, p))) out.add(p);
    } catch {
      /* unreadable path ⇒ skip it */
    }
  }
  return [...out];
}

/**
 * Pure planner (task spec §10): from a validated gate manifest (+ optional
 * gate log for failing-test extraction), decide TARGETED checks or escalate.
 */
export function planTargetedChecks({
  manifest,
  gateLogText,
  exists = fsExists,
  testAuthority = 'VITEST_TRANSITION',
}) {
  if (!manifest)
    return { mode: 'ESCALATE_FULL', reason: 'no structured gate manifest', checks: [] };
  if (manifest.passed === true)
    return {
      mode: 'ESCALATE_FULL',
      reason: 'manifest claims PASS — inconsistent with a failure-repair context',
      checks: [],
    };
  const failed = Array.isArray(manifest.checks)
    ? manifest.checks.filter((c) => c && c.status !== 'PASS')
    : [];
  if (failed.length === 0)
    return {
      mode: 'ESCALATE_FULL',
      reason: 'failed gate without any failing check row (blocked pre-checks?)',
      checks: [],
    };
  const categories = [...new Set(failed.map((c) => String(c.category ?? 'UNKNOWN')))];
  if (categories.some((c) => !KNOWN_CATEGORIES.has(c)))
    return {
      mode: 'ESCALATE_FULL',
      reason: `unknown failure category: ${categories.join(', ')}`,
      checks: [],
    };
  if (categories.length > 1)
    return {
      mode: 'ESCALATE_FULL',
      reason: `multiple failure categories (${categories.join(' + ')}) — conservative escalation`,
      checks: [],
    };
  const cat = categories[0];
  if (cat === 'PACKAGE')
    return {
      mode: 'TARGETED',
      reason: 'single failed category PACKAGE — re-run the exact recorded commands',
      checks: failed.map((c) => ({
        label: `package check (targeted): ${String(c.command).slice(0, 120)}`,
        command: String(c.command),
      })),
    };
  if (cat === 'TESTS') {
    const files = extractFailingTestFiles(gateLogText ?? '', exists);
    if (files.length > 0)
      return {
        mode: 'TARGETED',
        reason: `failing test files identified in the gate log (${files.length} unique)`,
        checks: [
          {
            label: `targeted tests: ${files.join(' ')}`.slice(0, 240),
            command:
              testAuthority === 'BUN_TEST'
                ? `bun test --no-orphans --isolate --parallel=1 ${files.join(' ')}`
                : `pnpm exec vitest run ${files.join(' ')}`,
          },
        ],
      };
    return {
      mode: 'TARGETED',
      reason: 'TESTS failure without identifiable files — full-suite rerun (conservative)',
      checks: [{ label: 'full test suite', command: 'pnpm test' }],
    };
  }
  return {
    mode: 'TARGETED',
    reason: `single failed category ${cat}`,
    checks: [{ label: CATEGORY_COMMANDS[cat], command: CATEGORY_COMMANDS[cat] }],
  };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--manifest') a.manifest = argv[++i];
    else if (argv[i] === '--artifacts-dir') a.artifactsDir = argv[++i];
    else if (argv[i] === '--gate-log') a.gateLog = argv[++i];
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.manifest || !a.artifactsDir) {
    console.error(
      'usage: package-targeted-verify.mjs --manifest <full-gate-result.json> --artifacts-dir <dir> [--gate-log <file>]',
    );
    process.exit(2);
  }
  let raw = null;
  try {
    raw = readFileSync(a.manifest, 'utf8');
  } catch {
    raw = null;
  }
  let gateLogText = '';
  if (a.gateLog) {
    try {
      gateLogText = readFileSync(a.gateLog, 'utf8');
    } catch {
      gateLogText = ''; // absent log degrades TESTS planning to full rerun, never crashes
    }
  }
  let testAuthority = 'VITEST_TRANSITION';
  try {
    testAuthority = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', 'config', 'foresift-test-runtime.json'),
        'utf8',
      ),
    ).currentAuthority;
  } catch {}
  const plan = planTargetedChecks({
    manifest: parseFullGateResult(raw),
    gateLogText,
    testAuthority,
  });

  const results = [];
  let allGreen = true;
  if (plan.mode === 'TARGETED') {
    for (const c of plan.checks) {
      console.log(`\n═══ TARGETED ▸ ${c.label}\n═══ $ ${c.command}`);
      const res = spawnSync(c.command, { shell: true, stdio: 'inherit', env: process.env });
      const status = res.status === 0 ? 'PASS' : 'FAIL';
      results.push({ label: c.label, command: c.command, status });
      if (res.status !== 0) {
        allGreen = false;
        break; // first red ends the pass — the repair loop iterates with fresh evidence
      }
    }
  }

  const record = {
    schema: TARGETED_SCHEMA,
    mode: plan.mode,
    reason: plan.reason,
    basedOnManifest: resolve(a.manifest),
    checks: results,
    allGreen,
    timestamp: new Date().toISOString(),
  };
  try {
    writeFileSync(
      join(a.artifactsDir, TARGETED_RESULT_FILE),
      JSON.stringify(record, null, 2) + '\n',
    );
  } catch {
    /* artifacts-dir failures must not flip the verdict */
  }

  if (plan.mode === 'ESCALATE_FULL') {
    console.error(`\n▲ TARGETED ▸ escalated to FULL gate: ${plan.reason}`);
    process.exit(3);
  }
  console.log(allGreen ? '\n✅ TARGETED VERIFICATION GREEN' : '\n✗ TARGETED VERIFICATION RED');
  process.exit(allGreen ? 0 : 1);
}

const invokedDirectly = process.argv[1]?.endsWith('package-targeted-verify.mjs');
if (invokedDirectly) main();
