// Global ready queue + work stealing (Hyperdrive H3, P1-7).
//
// The selection loop already re-runs canStartPackage against the LIVE running
// set per candidate within one tick (same-tick slot filling). This module is
// the P1-7 throughput layer on top of that primitive:
//
//   1. GLOBAL READY QUEUE — one ordered candidate stream per tick, ranked by
//      critical-path priority, each entry carrying its EXACT write-truth
//      preflight record (launch-preflight.mjs). The stream is shared: every
//      launch decision pops from the same queue instead of each decision site
//      re-deriving its own candidate order.
//
//   2. EXACT CO-RUN GATE — pairwise co-run admission upgraded from broad
//      writeScopes overlap to exact predicted-write disjointness when BOTH
//      sides carry derivable exact truth. Unknown truth on either side degrades
//      to the existing broad-scope behavior (exact:null ⇒ never upgrades
//      safety away). Dependency/CRITICAL/parallelizability truth stays owned
//      by schema.canStartPackage — this gate only ever REFUSES pairs the broad
//      gate would have allowed.
//
//   3. WORK STEALING ADMISSION SHAPE — the queue exposes `admitNext`, a
//      deterministic pop loop a caller can re-enter after any capacity event
//      (permit release, lane completion, pool reset) to steal the next
//      compatible unit of global ready work. The supervisor's tick loop is the
//      first caller; the module itself is provider-agnostic.
//
// Zero AI: everything here is deterministic scheduling bookkeeping.

import { buildLaunchPreflight, exactCoRunCompatible } from './launch-preflight.mjs';

export const READY_QUEUE_SCHEMA = 'foresift/ready-queue@1';

/**
 * Build the per-tick global ready queue.
 *
 * @param ms current-milestone document (ranked by critical-path score upstream)
 * @param orderedCandidates candidates already in priority order (rankPendingPackages)
 * @param preflight buildLaunchPreflight-shaped (packageId, rootDir?) ⇒ record;
 *   injectable for tests. Results are memoized per packageId for this queue.
 */
export function buildReadyQueue(orderedCandidates, preflight = buildLaunchPreflight) {
  const entries = [];
  const byId = new Map();
  for (const cand of orderedCandidates) {
    const id = typeof cand === 'string' ? cand : cand.id;
    if (byId.has(id)) continue;
    const record = preflight(id);
    const entry = { packageId: id, preflight: record };
    entries.push(entry);
    byId.set(id, entry);
  }
  return { schema: READY_QUEUE_SCHEMA, entries, byId };
}

/**
 * Exact co-run gate for ONE candidate against the RUNNING set.
 *
 * Returns {ok:true} when nothing objects beyond the broad gate, {ok:false,
 * reason} when an exact-write collision forbids the co-run, and never
 * relaxes a refusal the caller already made. Pairwise broad checks (scopes,
 * dependency, CRITICAL) remain the caller's job — this function is the
 * exact-truth refinement layered on top.
 */
export function exactCoRunGate(candidatePreflight, runningPreflights) {
  for (const run of runningPreflights ?? []) {
    const verdict = exactCoRunCompatible(candidatePreflight, run);
    if (verdict.compatible === false)
      return { ok: false, reason: `exact write overlap with ${run.packageId}: ${verdict.reason}` };
    // compatible === null (unknown truth on either side): degrade to broad
    // scopes — the caller's existing canStartPackage verdict stands.
  }
  return { ok: true, reason: 'exact co-run permitted' };
}

/**
 * Work-stealing pop: iterate the queue in priority order and return the first
 * candidate admitted by `admit(candidate, preflight)`. `admit` returns a
 * truthy value to claim the slot (its result becomes the return value) or a
 * falsy value to skip the candidate this round. Consumed candidates are
 * removed from the queue so a later steal pass never re-considers them.
 */
export function stealNext(queue, admit) {
  const entries = queue.entries ?? [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const claimed = admit(entry, entry.preflight);
    if (claimed) {
      entries.splice(i, 1);
      return claimed;
    }
    // A skipped candidate is not claiming a slot this round; the next steal
    // pass re-considers it in priority order unless it is claimed then.
  }
  return null;
}
