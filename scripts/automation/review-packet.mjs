#!/usr/bin/env node
// C4 §15 — DETERMINISTIC REVIEW PACKET (context accelerator, NOT authority).
//
// Builds $ARTIFACTS_DIR/review-packet.json BEFORE the independent-review fan-
// out so every reviewer starts from the same machine-derived facts instead of
// repeating broad repository reads: identity (package/risk/profile), exact
// reviewed HEAD + diff identity, changed files, affected requirements/
// acceptance criteria/PRD-ADR-SpecKit references, tests touched, FULL-gate
// evidence, out-of-scope notes, permanent product boundaries, known open
// issues and checkpoint references.
//
// Direction of failure: the packet NEVER blocks review (it is an accelerator)
// but it NEVER lies — any input that is missing/malformed makes the packet
// degraded (valid=false + reasons) so consumers treat it as absent rather
// than trusting partial context. The exact reviewed HEAD is the binding: a
// later validateReviewPacket against a different HEAD fails closed.
//
// The packet contains NO timestamp on purpose: its freshness is exactly its
// reviewedHeadSha + headTreeHash, so two builds at the same tree are
// byte-identical (deterministic by construction).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { findPackage, loadCurrentMilestone } from './schema.mjs';
import { deriveCapsule } from './package-checkpoint.mjs';
import { resolveSliceChangeset } from './slice-changeset.mjs';
import { resolveFastBase } from './package-fast-verify.mjs';
import { GATE_RESULT_FILE, parseFullGateResult } from './package-full-gate.mjs';

export const REVIEW_PACKET_SCHEMA = 'foresift/review-packet@1';
export const REVIEW_PACKET_FILE = 'review-packet.json';

// Permanent product security boundary (PRD prohibited-capability policy).
// Verbatim constant so reviewers see the same string every time.
export const PERMANENT_BOUNDARIES =
  'READ_ONLY_NO_TRADING_CUSTODY_SIGNING: no trading execution, no custody, ' +
  'no wallet signing, no private-key handling, no transaction submission. This ' +
  'policy is permanent and may not be weakened by any change under review.';

const CHECKPOINT_FILE = 'implementation-checkpoint.json';

function git(repoRoot, args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Build the packet. Never throws for missing OPTIONAL evidence — degradation
 * is recorded. Throws only on programmer/usage errors (bad args shape).
 */
export function buildReviewPacket({ packageId, repoRoot, artifactsDir }) {
  if (!packageId || !repoRoot || !artifactsDir)
    throw new Error('buildReviewPacket requires packageId, repoRoot, artifactsDir');

  const reasons = [];
  const art = (name) => join(artifactsDir, name);

  // ── identity ──────────────────────────────────────────────────────────────
  let risk = null;
  let writeScopes = [];
  try {
    const ms = loadCurrentMilestone(repoRoot);
    const pkg = findPackage(ms, packageId);
    if (pkg) {
      risk = pkg.risk ?? null;
      writeScopes = pkg.writeScopes ?? [];
    } else {
      reasons.push(`package ${packageId} not found in current milestone`);
    }
  } catch (err) {
    reasons.push(`milestone metadata unavailable: ${String(err?.message ?? err).slice(0, 120)}`);
  }

  // ── exact reviewed HEAD + diff identity ───────────────────────────────────
  const reviewedHeadSha = git(repoRoot, ['rev-parse', 'HEAD']);
  const headTreeHash = reviewedHeadSha ? git(repoRoot, ['rev-parse', 'HEAD^{tree}']) : null;
  if (!reviewedHeadSha || !headTreeHash) reasons.push('HEAD could not be resolved via git');

  const baseInfo = resolveFastBase({ repoRoot, packageId, artifactsDir });
  let filesChanged = [];
  let diffIdentity = null;
  if (baseInfo.baseRef && reviewedHeadSha) {
    const cs = resolveSliceChangeset({ repoRoot, baseRef: baseInfo.baseRef });
    if (cs.unknown) {
      reasons.push(`slice changeset unknown: ${cs.reasons.join('; ').slice(0, 160)}`);
    } else {
      filesChanged = [...cs.files].sort((a, b) => (a.path < b.path ? -1 : 1));
      // Content-binding diff identity: sorted status:path rows plus the tree
      // hash of the reviewed HEAD. Same inputs ⇒ same hex digest, always.
      diffIdentity = sha256(
        JSON.stringify({
          headTreeHash,
          baseRef: baseInfo.baseRef,
          rows: filesChanged.map((f) => `${f.status}:${f.path}`),
        }),
      );
    }
  } else {
    reasons.push(`no resolvable slice base (${baseInfo.source})`);
  }

  // ── requirement / acceptance / PRD / ADR / SpecKit context ───────────────
  let capsuleRefs = null;
  try {
    const cap = deriveCapsule({ repoRoot, packageId, artifactsDir });
    capsuleRefs = {
      profile: cap.profile,
      objective: cap.objective,
      requirementIds: cap.requirementIds,
      acceptanceIds: cap.acceptanceIds,
      prdReferences: cap.prdReferences,
      adrReferences: cap.adrReferences,
      specKitArtifacts: cap.specKitArtifacts,
      firstUnfinishedTask: cap.firstUnfinishedTask,
    };
    if (cap.risk && !risk) risk = cap.risk;
  } catch (err) {
    reasons.push(`context capsule unavailable: ${String(err?.message ?? err).slice(0, 120)}`);
  }

  // ── FULL gate evidence + attestation (if they exist yet) ──────────────────
  let fullGateEvidence = null;
  try {
    const raw = readFileSync(art(GATE_RESULT_FILE), 'utf8');
    const m = parseFullGateResult(raw);
    fullGateEvidence = m
      ? { present: true, passed: m.passed, failedCategories: m.failedCategories }
      : { present: false };
    if (!m) reasons.push('full-gate manifest present but unparseable');
  } catch {
    fullGateEvidence = { present: false };
  }
  let attestationEvidence = { present: false };
  try {
    const a = JSON.parse(readFileSync(art('full-gate-attestation.json'), 'utf8'));
    attestationEvidence = {
      present: true,
      result: typeof a.result === 'string' ? a.result : null,
      headSha: typeof a.headSha === 'string' ? a.headSha : null,
    };
  } catch {
    /* absent — normal before the first FULL run */
  }

  // ── out-of-scope notes, checkpoint, known open issues ─────────────────────
  const notesPath = art('out-of-scope-notes.md');
  const outOfScopeNotes = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : null;

  let checkpointRef = { present: false };
  try {
    const cp = JSON.parse(readFileSync(art(CHECKPOINT_FILE), 'utf8'));
    checkpointRef = {
      present: true,
      packageId: cp.packageId ?? null,
      headSha: cp.headSha ?? null,
      sliceId: cp.slice?.id ?? null,
    };
  } catch {
    /* absent */
  }

  const knownUnresolvedIssues = [];
  if (capsuleRefs?.firstUnfinishedTask)
    knownUnresolvedIssues.push(
      `unfinished task @tasks.md:${capsuleRefs.firstUnfinishedTask.line}: ${capsuleRefs.firstUnfinishedTask.text}`,
    );
  try {
    const v = JSON.parse(readFileSync(art('review-verdict.json'), 'utf8'));
    if (typeof v.unresolvedThreads === 'number' && v.unresolvedThreads > 0)
      knownUnresolvedIssues.push(`${v.unresolvedThreads} unresolved PR review threads`);
  } catch {
    /* no prior review */
  }

  const packet = {
    schema: REVIEW_PACKET_SCHEMA,
    packageId,
    risk,
    writeScopes,
    ...capsuleRefs,
    baseRef: baseInfo.baseRef ?? null,
    baseSource: baseInfo.source,
    reviewedHeadSha,
    headTreeHash,
    diffIdentity,
    filesChanged,
    testsAddedOrChanged: filesChanged.filter((f) => f.path.startsWith('tests/')).map((f) => f.path),
    fullGateEvidence,
    attestationEvidence,
    outOfScopeNotes,
    permanentBoundaries: PERMANENT_BOUNDARIES,
    knownUnresolvedIssues,
    checkpointRef,
    valid: false,
    reasons,
  };
  packet.valid = reasons.length === 0;
  return packet;
}

/**
 * Fail-closed validation against expectations. The critical check is the HEAD
 * binding: anything that moved HEAD since build invalidates the packet.
 */
export function validateReviewPacket(packet, { expectedHead } = {}) {
  const reasons = [];
  if (!packet || typeof packet !== 'object') return { valid: false, reasons: ['not an object'] };
  if (packet.schema !== REVIEW_PACKET_SCHEMA) reasons.push('schema mismatch');
  if (typeof packet.reviewedHeadSha !== 'string' || !/^[0-9a-f]{40}$/.test(packet.reviewedHeadSha))
    reasons.push('reviewedHeadSha missing or malformed');
  if (packet.valid === false && Array.isArray(packet.reasons))
    reasons.push(...packet.reasons.map((r) => `built degraded: ${r}`));
  if (expectedHead && packet.reviewedHeadSha !== expectedHead)
    reasons.push(`HEAD changed after packet build (${expectedHead.slice(0, 12)})`);
  return { valid: reasons.length === 0, reasons };
}

/**
 * Deterministic finding aggregation. Findings are EXACT duplicates only when
 * every semantic field matches; those merge into one entry with an
 * occurrences count. Anything differing in ANY field stays separate —
 * genuine disagreement is never suppressed.
 */
export function aggregateFindings(findings) {
  const byKey = new Map();
  const order = [];
  let exactDuplicatesMerged = 0;
  for (const f of findings ?? []) {
    const key = JSON.stringify([
      f.severity ?? null,
      f.category ?? null,
      f.file ?? null,
      f.line ?? null,
      f.requirementId ?? null,
      f.finding ?? null,
      f.requiredFix ?? null,
    ]);
    if (!byKey.has(key)) {
      byKey.set(key, { ...f, occurrences: 1 });
      order.push(key);
    } else {
      byKey.get(key).occurrences += 1;
      exactDuplicatesMerged += 1;
    }
  }
  return { aggregated: order.map((k) => byKey.get(k)), exactDuplicatesMerged };
}

const invokedDirectly = process.argv[1]?.endsWith('review-packet.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--package':
        a.packageId = argv[++i];
        break;
      case '--artifacts-dir':
        a.artifactsDir = argv[++i];
        break;
      case '--repo-root':
        a.repoRoot = argv[++i];
        break;
      default:
        console.error(
          `usage: review-packet.mjs --package <id> --artifacts-dir <dir> [--repo-root <root>] (unknown arg ${argv[i]})`,
        );
        process.exit(2);
    }
  }
  if (!a.packageId || !a.artifactsDir) {
    console.error(
      'usage: review-packet.mjs --package <id> --artifacts-dir <dir> [--repo-root <root>]',
    );
    process.exit(2);
  }
  const repoRoot = a.repoRoot ?? process.cwd();
  const packet = buildReviewPacket({
    packageId: a.packageId,
    repoRoot,
    artifactsDir: a.artifactsDir,
  });
  writeFileSync(join(a.artifactsDir, REVIEW_PACKET_FILE), `${JSON.stringify(packet, null, 2)}\n`);
  console.log(`REVIEW_PACKET_VALID=${packet.valid}`);
  console.log(`REVIEW_PACKET_HEAD=${packet.reviewedHeadSha ?? 'unknown'}`);
  console.log(`REVIEW_PACKET_FILES=${packet.filesChanged.length}`);
  // The accelerator NEVER fails the workflow: degraded packets record why.
  process.exit(0);
}
