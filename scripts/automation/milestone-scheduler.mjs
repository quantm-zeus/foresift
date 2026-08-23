#!/usr/bin/env node
// C4 §17 — LATER-MILESTONE CRITICAL-PATH SCHEDULER (deterministic, pure).
//
// G0 (foundation) concurrency is UNCHANGED: roadmap.policy pins foundation
// milestones to maxParallelCodingPackagesFoundation=1 and canStartPackage()
// remains the single source of every eligibility constraint (status, deps,
// CRITICAL serialization, parallelizable pairing, write-scope overlap,
// dependency relationships). This module adds only a deterministic PRIORITY
// ORDER among candidates that are already eligible, so milestones with
// explicit concurrency (max 2) minimize total makespan instead of picking by
// naive ordering:
//
//     longest downstream path  desc   (critical path first)
//     unlocked downstream count desc (packages it frees)
//     risk severity             desc  (CRITICAL/HIGH earlier when tied)
//     package id                asc    (total determinism)
//
// Pure functions + Node stdlib only; no workflow topology is changed here.

import { findPackage } from './schema.mjs';

const RISK_RANK = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };

/** Direct dependents of pkgId within the milestone. */
function directDependents(ms, pkgId) {
  return (ms?.packages ?? [])
    .filter((p) => (p.dependencies ?? []).includes(pkgId))
    .map((p) => p.id);
}

/**
 * Longest chain pkgId → dependents → … inside the milestone (memoized).
 * A package on the milestone's critical path has the largest value.
 */
export function longestDownstreamPath(ms, pkgId, memo = new Map()) {
  if (memo.has(pkgId)) return memo.get(pkgId);
  // Cycle guard: treat an in-progress visit as length 0 (invalid graphs are
  // rejected by milestone validation upstream; this keeps the function total).
  memo.set(pkgId, 0);
  let best = 0;
  for (const dep of directDependents(ms, pkgId)) {
    best = Math.max(best, 1 + longestDownstreamPath(ms, dep, memo));
  }
  memo.set(pkgId, best);
  return best;
}

/** Transitive PENDING packages that become reachable once pkgId is PROVEN. */
export function unlockedDownstreamCount(ms, pkgId) {
  const byId = Object.fromEntries((ms?.packages ?? []).map((p) => [p.id, p]));
  const seen = new Set();
  const stack = [...directDependents(ms, pkgId)];
  let count = 0;
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    if ((byId[cur]?.status ?? 'PENDING') === 'PENDING') count += 1;
    stack.push(...directDependents(ms, cur));
  }
  return count;
}

/**
 * Deterministic priority tuple for one candidate.
 * Higher sorts first; `id` breaks ties so the order is total.
 */
export function criticalPathScore(ms, pkg) {
  return {
    longestDownstreamPath: longestDownstreamPath(ms, pkg.id),
    unlockedDownstreamCount: unlockedDownstreamCount(ms, pkg.id),
    riskRank: RISK_RANK[pkg.risk] ?? -1,
    id: pkg.id,
  };
}

function compareScores(a, b) {
  if (a.longestDownstreamPath !== b.longestDownstreamPath)
    return b.longestDownstreamPath - a.longestDownstreamPath;
  if (a.unlockedDownstreamCount !== b.unlockedDownstreamCount)
    return b.unlockedDownstreamCount - a.unlockedDownstreamCount;
  if (a.riskRank !== b.riskRank) return b.riskRank - a.riskRank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Rank PENDING packages whose dependencies are satisfied, annotate each with
 * whether it may START given the running set, and select the first startable
 * candidate by critical-path priority. Deterministic: same inputs ⇒ same
 * selection.
 *
 * @param canStart (candidate, runningPackages) ⇒ {ok, reason} — pass a thin
 *   adapter over schema.mjs canStartPackage so every policy constraint stays
 *   owned THERE (this module never re-implements eligibility).
 * @returns {{selected: {id: string, score: object} | null,
 *            ranked: Array<{id, score, startable, reason}>}}
 */
export function selectNextPackage(canStart, ms, runningPackages = []) {
  // Same eligibility predicate as schema.packageEligible: the candidate itself
  // must be PENDING and every dependency must already be PROVEN.
  const pending = (ms?.packages ?? []).filter(
    (p) =>
      (p.status ?? 'PENDING') === 'PENDING' &&
      (p.dependencies ?? []).every((d) => findPackage(ms, d)?.status === 'PROVEN'),
  );
  const ranked = pending
    .map((p) => {
      const score = criticalPathScore(ms, p);
      const verdict = canStart(p, runningPackages);
      return { id: p.id, score, startable: Boolean(verdict.ok), reason: verdict.reason };
    })
    .sort((a, b) => compareScores(a.score, b.score));
  const selected = ranked.find((r) => r.startable) ?? null;
  return {
    selected: selected ? { id: selected.id, score: selected.score } : null,
    ranked,
  };
}

/**
 * Runtime wiring (V3-B): the supervisor's candidate ORDER for one tick.
 * Returns PENDING packages sorted by critical-path priority — a fixed order
 * computed once per tick so mid-tick status flips (PENDING→RUNNING after each
 * launch) cannot reshuffle the remaining candidates. Eligibility is NOT
 * decided here: the caller still gates every candidate through
 * packageEligible + canStartPackage against the LIVE running set, which is
 * what makes same-tick slot filling safe (launch A, re-evaluate against A,
 * launch B in the same cycle).
 */
export function rankPendingPackages(ms) {
  return (ms?.packages ?? [])
    .filter((p) => (p.status ?? 'PENDING') === 'PENDING')
    .map((pkg) => ({ pkg, score: criticalPathScore(ms, pkg) }))
    .sort((a, b) => compareScores(a.score, b.score))
    .map((x) => x.pkg);
}
