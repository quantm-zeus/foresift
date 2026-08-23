#!/usr/bin/env node
// Deterministic review-outcome collector (V2 task spec §11). The bundled
// archon-review-block sub-DAG is a packed binary whose internal verdicts are
// not machine-readable, so convergence routing consumes GITHUB'S OWN review
// state instead — reviewDecision and unresolved thread count — plus HEAD
// stability evidence, composed into $ARTIFACTS_DIR/review-verdict.json.
//
//   node scripts/automation/review-outcome-collector.mjs \
//     --artifacts-dir <dir> [--repo-root <dir>]
//
// Reads (from the artifacts dir):  .review-head-snapshot.json (pre-review HEAD,
// written by the workflow's snapshot node) and .pr-number (written by the
// create-pr stage). This node NEVER fails the workflow: any missing/unknown
// input produces verdict.valid=false, which the downstream convergence-router
// turns into CONVERGENCE_REQUIRED (fail-closed = today's behavior).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REVIEW_VERDICT_SCHEMA = 'foresift/review-verdict@1';
export const REVIEW_VERDICT_FILE = 'review-verdict.json';
const HEX40 = /^[0-9a-f]{40}$/;
const DECISIONS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']);

function ghJson(args, cwd) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', cwd }));
}

export function collectReviewOutcome({ artifactsDir, repoRoot }) {
  const reasons = [];
  const verdict = {
    schema: REVIEW_VERDICT_SCHEMA,
    valid: false,
    prNumber: null,
    prUrl: null,
    reviewDecision: null,
    unresolvedThreads: null,
    headAtReviewStart: null,
    headAfterReview: null,
    collectedAt: new Date().toISOString(),
    reasons,
  };

  // Pre-review HEAD snapshot (written by the workflow's snapshot node).
  try {
    const snap = JSON.parse(readFileSync(join(artifactsDir, '.review-head-snapshot.json'), 'utf8'));
    if (typeof snap?.headSha === 'string' && HEX40.test(snap.headSha))
      verdict.headAtReviewStart = snap.headSha;
    else reasons.push('pre-review head snapshot has no valid headSha');
  } catch {
    reasons.push('pre-review head snapshot missing/unreadable');
  }

  // Post-review HEAD as seen by the collector itself.
  try {
    verdict.headAfterReview = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    reasons.push('could not read current HEAD');
  }

  // PR number artifact written by the create-pr stage.
  try {
    const raw = readFileSync(join(artifactsDir, '.pr-number'), 'utf8').trim();
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n > 0) verdict.prNumber = n;
    else reasons.push('.pr-number artifact is not a positive integer');
  } catch {
    reasons.push('.pr-number artifact missing/unreadable');
  }

  if (verdict.prNumber != null) {
    // GitHub's own structured review state.
    try {
      const pr = ghJson(
        ['pr', 'view', String(verdict.prNumber), '--json', 'reviewDecision,headRefOid,url'],
        repoRoot,
      );
      verdict.prUrl = pr.url ?? null;
      if (DECISIONS.has(pr.reviewDecision)) verdict.reviewDecision = pr.reviewDecision;
      else reasons.push(`GitHub reviewDecision '${pr.reviewDecision}' is not a known state`);
    } catch (err) {
      reasons.push(`gh pr view failed: ${String(err?.message ?? err).slice(0, 140)}`);
    }

    // Unresolved review threads via GraphQL (informational: APPROVED already
    // implies GitHub considers blocking threads resolved; when GraphQL is
    // unavailable we record null rather than guessing).
    try {
      const [owner, name] = (process.env.GITHUB_REPOSITORY ?? '/').split('/');
      const q =
        'query($n:Int!,$o:String!,$r:String!){repository(owner:$o,name:$r){pullRequests(first:1,number:$n){nodes{reviewThreads(first:100){nodes{isResolved}}}}}}';
      const res = ghJson(
        [
          'api',
          'graphql',
          '-f',
          `query=${q}`,
          '-f',
          `owner=${owner}`,
          '-f',
          `name=${name}`,
          '-F',
          `n=${verdict.prNumber}`,
        ],
        repoRoot,
      );
      const nodes = res?.data?.repository?.pullRequests?.nodes?.[0]?.reviewThreads?.nodes ?? null;
      if (Array.isArray(nodes))
        verdict.unresolvedThreads = nodes.filter((t) => !t.isResolved).length;
    } catch {
      reasons.push('unresolved-thread count unavailable (GraphQL)');
    }
  }

  verdict.valid =
    verdict.headAtReviewStart !== null &&
    HEX40.test(verdict.headAfterReview ?? '') &&
    verdict.prNumber !== null &&
    verdict.reviewDecision !== null;
  return verdict;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--artifacts-dir') a.artifactsDir = argv[++i];
    else if (argv[i] === '--repo-root') a.repoRoot = argv[++i];
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.artifactsDir) {
    console.error('usage: review-outcome-collector.mjs --artifacts-dir <dir> [--repo-root <dir>]');
    process.exit(2);
  }
  const verdict = collectReviewOutcome({
    artifactsDir: resolve(a.artifactsDir),
    repoRoot: resolve(a.repoRoot ?? process.cwd()),
  });
  try {
    writeFileSync(
      join(resolve(a.artifactsDir), REVIEW_VERDICT_FILE),
      JSON.stringify(verdict, null, 2) + '\n',
    );
  } catch {
    /* artifacts-dir failure must not crash the pipeline node */
  }
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(0); // NEVER fails the DAG — invalidity routes to CONVERGENCE_REQUIRED.
}

const invokedDirectly = process.argv[1]?.endsWith('review-outcome-collector.mjs');
if (invokedDirectly) main();
