#!/usr/bin/env node
// DETERMINISTIC convergence router (V2 task spec §11). Decides whether the
// Spec Kit convergence stage must run for this package, using ONLY
// machine-checkable evidence — never an agent's claim:
//
//   CONVERGENCE_NOT_REQUIRED requires ALL of:
//     1. a VALID review verdict (review-outcome-collector output) whose GitHub
//        reviewDecision is APPROVED;
//     2. HEAD is UNCHANGED across the whole review window (snapshot == current
//        == post-review) — no commit can have invalidated gate evidence;
//     3. a FULL-gate attestation exists AND matches the CURRENT identity
//        exactly (head, lock, authorities, gate code, toolchain);
//     4. the deterministic implementation-completeness validator passes.
//
//   ANY missing/malformed/contradictory input ⇒ CONVERGENCE_REQUIRED.
//   Fail-closed by construction: skipping convergence is the OPTIMIZATION;
//   running it is always safe and is what happens under any doubt.
//
//   node scripts/automation/convergence-router.mjs \
//     --package <id> --artifacts-dir <dir> [--repo-root <dir>]
//
// Exit codes: 0 = CONVERGENCE_NOT_REQUIRED, 1 = CONVERGENCE_REQUIRED,
// 2 = usage error. Writes $ARTIFACTS_DIR/convergence-decision.json.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { attestationDrift, attestationIdentity, ATTESTATION_FILE } from './package-full-gate.mjs';
import { REVIEW_VERDICT_FILE, REVIEW_VERDICT_SCHEMA } from './review-outcome-collector.mjs';
import { implementationComplete } from './package-implement-complete.mjs';

export const DECISION_NOT_REQUIRED = 'CONVERGENCE_NOT_REQUIRED';
export const DECISION_REQUIRED = 'CONVERGENCE_REQUIRED';
export const DECISION_SCHEMA = 'foresift/convergence-decision@1';

/** Parse + structurally validate a review verdict; null when unusable. */
export function parseReviewVerdict(raw) {
  if (typeof raw !== 'string') return null;
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  if (v.schema !== REVIEW_VERDICT_SCHEMA) return null;
  if (typeof v.valid !== 'boolean') return null;
  return v;
}

/**
 * Pure decision core. `attestation` is { present:boolean, drift:string[]|null }
 * (precomputed so tests can inject evidence without a git checkout).
 */
export function decideConvergence({ currentHead, verdict, attestation, completeness }) {
  const reasons = [];

  if (!verdict || verdict.valid !== true) {
    reasons.push('review verdict missing or marked invalid (fail-closed)');
  } else {
    if (verdict.reviewDecision !== 'APPROVED')
      reasons.push(`GitHub reviewDecision is '${verdict.reviewDecision}', not APPROVED`);
    if (typeof verdict.unresolvedThreads === 'number' && verdict.unresolvedThreads > 0)
      reasons.push(`${verdict.unresolvedThreads} unresolved review thread(s)`);
    if (verdict.headAtReviewStart !== currentHead)
      reasons.push('HEAD moved since the pre-review snapshot');
    if (verdict.headAfterReview !== currentHead)
      reasons.push('HEAD changed during or after review');
  }

  if (!attestation?.present) reasons.push('no FULL-gate attestation present');
  else if (attestation.drift) reasons.push(`attestation drift: ${attestation.drift.join(', ')}`);

  if (completeness?.complete !== true)
    reasons.push('implementation-completeness validator does not report complete');

  return {
    schema: DECISION_SCHEMA,
    decision: reasons.length ? DECISION_REQUIRED : DECISION_NOT_REQUIRED,
    currentHead,
    reasons,
    decidedAt: new Date().toISOString(),
  };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--package') a.package = argv[++i];
    else if (argv[i] === '--artifacts-dir') a.artifactsDir = argv[++i];
    else if (argv[i] === '--repo-root') a.repoRoot = argv[++i];
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.package || !a.artifactsDir) {
    console.error(
      'usage: convergence-router.mjs --package <id> --artifacts-dir <dir> [--repo-root <dir>]',
    );
    process.exit(2);
  }
  const repoRoot = resolve(a.repoRoot ?? process.cwd());
  const artifactsDir = resolve(a.artifactsDir);

  let decision;
  try {
    const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();

    // Evidence 1+2: review verdict (validated structurally here).
    let verdict = null;
    try {
      verdict = parseReviewVerdict(readFileSync(join(artifactsDir, REVIEW_VERDICT_FILE), 'utf8'));
    } catch {
      verdict = null;
    }

    // Evidence 3: FULL-gate attestation at the CURRENT identity.
    let attestation = { present: false, drift: null };
    try {
      const attested = JSON.parse(readFileSync(join(artifactsDir, ATTESTATION_FILE), 'utf8'));
      if (attested?.result !== 'PASS') throw new Error('not a PASS record');
      const current = attestationIdentity({ packageId: a.package, repoRoot });
      attestation = {
        present: true,
        drift: attestationDrift(attested.identity ?? attested, current),
      };
    } catch {
      attestation = { present: false, drift: null };
    }

    // Evidence 4: deterministic implementation completeness.
    let completeness = { complete: false };
    try {
      completeness = implementationComplete(a.package, repoRoot);
    } catch {
      completeness = { complete: false };
    }

    decision = decideConvergence({ currentHead, verdict, attestation, completeness });
  } catch (err) {
    decision = {
      schema: DECISION_SCHEMA,
      decision: DECISION_REQUIRED,
      currentHead: null,
      reasons: [`router could not assemble evidence: ${String(err?.message ?? err).slice(0, 160)}`],
      decidedAt: new Date().toISOString(),
    };
  }

  try {
    writeFileSync(
      join(artifactsDir, 'convergence-decision.json'),
      JSON.stringify(decision, null, 2) + '\n',
    );
  } catch {
    /* artifacts-dir failure must not flip the decision */
  }
  console.log(JSON.stringify(decision, null, 2));
  process.exit(decision.decision === DECISION_NOT_REQUIRED ? 0 : 1);
}

const invokedDirectly = process.argv[1]?.endsWith('convergence-router.mjs');
if (invokedDirectly) main();
