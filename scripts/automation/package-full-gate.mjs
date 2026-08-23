#!/usr/bin/env node
// FULL verification gate with exact-head attestation (task spec §14/§15).
//
//   package-full-gate.mjs --run      --package <id> --artifacts-dir <dir>
//   package-full-gate.mjs --check    --package <id> --artifacts-dir <dir> [--head <sha>]
//
// --run executes the complete FULL gate (pnpm spec:verify, formatting, lint,
// full TypeScript, full test suite, unique package checks via foresift:gate)
// and, ONLY on PASS, persists $ARTIFACTS_DIR/full-gate-attestation.json keyed
// by the full relevant identity. --check validates an existing attestation
// against the CURRENT identity: reuse only if every hash still matches.
// Any new commit, authority change, toolchain change, or gate change
// invalidates it. Deterministic evidence reuse — NOT test skipping: a reused
// attestation proves THIS EXACT identity already passed the full gate.
//
// FAST verification can NEVER write or validate an attestation (spec rule G).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findPackage, loadCurrentMilestone, loadRoadmap } from './schema.mjs';
import { throughputProfile } from './work-package-throughput-profile.mjs';

export const ATTESTATION_FILE = 'full-gate-attestation.json';
export const GATE_RESULT_FILE = 'full-gate-result.json';
const GATE_RESULT_SCHEMA = 'foresift/full-gate-result@1';

/**
 * Parse a structured gate-result manifest (written by foresift-gate.mjs
 * --result-file). Returns the validated object, or null when absent/malformed/
 * wrong-schema — callers must treat null as "no structured evidence" and fail
 * closed (escalate to a FULL gate).
 */
export function parseFullGateResult(raw) {
  if (typeof raw !== 'string') return null;
  let r;
  try {
    r = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!r || typeof r !== 'object') return null;
  if (r.schema !== GATE_RESULT_SCHEMA) return null;
  if (typeof r.passed !== 'boolean') return null;
  if (!Array.isArray(r.checks)) return null;
  return r;
}

// Directory of the executing automation code (source of the gate-code hashes
// when --repo-root is a different/fixture checkout).
const AUTO_DIR = import.meta.dirname;

// loadRoadmap is imported to fail closed on corrupt state before any hashing.
void loadRoadmap;

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaOrNull = (p) => {
  try {
    return sha(p);
  } catch {
    return null;
  }
};
/** First candidate that exists and hashes cleanly; else null. The AUTO_DIR
 *  fallbacks always exist (they are the executing runner itself). */
const shaFirstExisting = (...candidates) => {
  for (const p of candidates) {
    if (p == null) continue;
    const h = shaOrNull(p);
    if (h) return h;
  }
  return null;
};

function toolchainVersions(repoRoot) {
  const out = { node: process.version };
  for (const [k, args] of [
    ['pnpm', ['--version']],
    ['typescript', ['./node_modules/.bin/tsc', '--version']],
    ['vitest', ['./node_modules/.bin/vitest', '--version']],
  ]) {
    try {
      out[k] = execFileSync(args[0], args.slice(1), { cwd: repoRoot, encoding: 'utf8' }).trim();
    } catch {
      out[k] = 'unavailable';
    }
  }
  return out;
}

/**
 * The full relevant identity of a FULL-gate execution (§15). Everything that
 * could change what "the FULL gate passed at HEAD" means rides in here.
 */
export function attestationIdentity({ packageId, repoRoot, resolveBaseMain } = {}) {
  const ms = loadCurrentMilestone();
  const pkg = findPackage(ms, packageId);
  if (!pkg) throw new Error(`package '${packageId}' not found in current milestone`);
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const headSha = git(['rev-parse', 'HEAD']);
  // V3-D §11: the origin/main tip this gate ran against (the LOCAL
  // remote-tracking ref — never guessed). A landing that reuses evidence
  // against a DIFFERENT main is stale-base evidence; the drift comparison
  // below invalidates reuse once main moved. No network here by design: the
  // landing path (final-land admission / lander) fetches BEFORE any --check
  // recomputation, so the ref is fresh exactly where the verdict matters.
  // Injectable for hermetic fixtures; null when the ref does not exist.
  const baseMainShaOrNull = () => {
    if (resolveBaseMain) return resolveBaseMain();
    try {
      return git(['rev-parse', '--verify', 'refs/remotes/origin/main']);
    } catch {
      return null;
    }
  };
  return {
    schema: 'foresift/full-gate-attestation@1',
    headSha,
    baseMainSha: baseMainShaOrNull(),
    packageId,
    risk: pkg.risk,
    profile: throughputProfile(packageId),
    pnpmLockHash: shaOrNull(join(repoRoot, 'pnpm-lock.yaml')),
    authorityHashes: {
      prdManifest: shaOrNull(
        join(
          repoRoot,
          'docs',
          'spec',
          'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
        ),
      ),
      currentMilestone: shaOrNull(
        join(repoRoot, 'specs', 'implementation', 'current-milestone.json'),
      ),
      roadmap: shaOrNull(join(repoRoot, 'specs', 'implementation', 'roadmap.json')),
    },
    gateImplementationHashes: {
      // Prefer the gate code inside the tree being verified; fall back to the
      // executing runner's own copy (identical in a normal checkout).
      gate: shaFirstExisting(
        join(repoRoot, 'scripts', 'automation', 'foresift-gate.mjs'),
        join(AUTO_DIR, 'foresift-gate.mjs'),
      ),
      schema: shaFirstExisting(
        join(repoRoot, 'scripts', 'automation', 'schema.mjs'),
        join(AUTO_DIR, 'schema.mjs'),
      ),
      runner: shaFirstExisting(
        join(repoRoot, 'scripts', 'automation', 'package-full-gate.mjs'),
        join(AUTO_DIR, 'package-full-gate.mjs'),
      ),
    },
    toolchain: toolchainVersions(repoRoot),
  };
}

/** Compare an attestation's recorded identity to the current one; null = match. */
export function attestationDrift(attested, current) {
  const drift = [];
  const cmp = (path, a, c) => {
    if (JSON.stringify(a) !== JSON.stringify(c)) drift.push(path);
  };
  cmp('headSha', attested.headSha, current.headSha);
  // V3-D §11: evidence gathered against a moved main is stale-base evidence.
  cmp('baseMainSha', attested.baseMainSha, current.baseMainSha);
  cmp('packageId', attested.packageId, current.packageId);
  cmp('risk', attested.risk, current.risk);
  cmp('pnpmLockHash', attested.pnpmLockHash, current.pnpmLockHash);
  for (const k of Object.keys(current.authorityHashes))
    cmp(`authorityHashes.${k}`, attested.authorityHashes?.[k], current.authorityHashes[k]);
  for (const k of Object.keys(current.gateImplementationHashes))
    cmp(
      `gateImplementationHashes.${k}`,
      attested.gateImplementationHashes?.[k],
      current.gateImplementationHashes[k],
    );
  for (const k of Object.keys(current.toolchain))
    cmp(`toolchain.${k}`, attested.toolchain?.[k], current.toolchain[k]);
  return drift.length ? drift : null;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--run':
        a.run = true;
        break;
      case '--check':
        a.check = true;
        break;
      case '--package':
        a.package = argv[++i];
        break;
      case '--artifacts-dir':
        a.artifactsDir = argv[++i];
        break;
      case '--repo-root':
        a.repoRoot = argv[++i];
        break;
      case '--head':
        a.headOverride = argv[++i];
        break;
    }
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.package || !a.artifactsDir || !(a.run ^ a.check)) {
    console.error(
      'usage: package-full-gate.mjs (--run | --check) --package <id> --artifacts-dir <dir>',
    );
    process.exit(2);
  }
  const repoRoot = resolve(a.repoRoot ?? process.cwd());
  const file = join(a.artifactsDir, ATTESTATION_FILE);

  if (a.check) {
    let attested;
    try {
      attested = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      console.log(JSON.stringify({ valid: false, reasons: ['no attestation present'] }));
      process.exit(1);
    }
    if (attested.result !== 'PASS') {
      console.log(JSON.stringify({ valid: false, reasons: ['attestation is not a PASS record'] }));
      process.exit(1);
    }
    const current = attestationIdentity({ packageId: a.package, repoRoot });
    if (a.headOverride) current.headSha = a.headOverride;
    const drift = attestationDrift(attested.identity ?? attested, current);
    if (drift) {
      console.log(JSON.stringify({ valid: false, reasons: drift.map((d) => `changed: ${d}`) }));
      process.exit(1);
    }
    console.log(
      JSON.stringify({
        valid: true,
        headSha: current.headSha,
        attestedAt: attested.timestamp,
      }),
    );
    process.exit(0);
  }

  // --run: execute the FULL gate itself, then persist the PASS attestation.
  // The gate also writes a structured per-check manifest into the artifacts
  // dir (task spec §9) on BOTH outcomes, so repair can plan targeted work.
  const resultFile = join(a.artifactsDir, GATE_RESULT_FILE);
  console.log(
    'FULL GATE ▸ foresift:gate (spec integrity + repository verification + package checks)',
  );
  try {
    execFileSync('pnpm', ['foresift:gate', '--package', a.package, '--result-file', resultFile], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } catch (err) {
    const status = err?.status ?? 1;
    // Guarantee structured evidence even when the gate died before writing one
    // (crash, signal, older gate binary): synthesize a fail-closed record.
    let existing = null;
    try {
      existing = parseFullGateResult(readFileSync(resultFile, 'utf8'));
    } catch {
      existing = null;
    }
    if (!existing) {
      writeFileSync(
        resultFile,
        JSON.stringify(
          {
            schema: GATE_RESULT_SCHEMA,
            packageId: a.package,
            passed: false,
            exitCode: status || 1,
            failedCategories: [],
            checks: [],
            synthesizedByRunner: true,
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        ) + '\n',
      );
    }
    console.error(`\n❌ FULL GATE FAILED (exit ${status}) — NO attestation written`);
    process.exit(status || 1);
  }
  const identity = attestationIdentity({ packageId: a.package, repoRoot });
  const record = {
    ...identity,
    result: 'PASS',
    command: 'pnpm foresift:gate --package ' + a.package,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  console.log(
    `\n✅ FULL GATE PASSED — attestation written for ${identity.headSha.slice(0, 10)} (${file})`,
  );
}

const invokedDirectly = process.argv[1]?.endsWith('package-full-gate.mjs');
if (invokedDirectly) main();
