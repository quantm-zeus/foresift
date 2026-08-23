// V3-D §11 — SAFE PARALLEL LANDING / BASE-DRIFT CONTRACT (pure decision core).
//
// With up to `maxParallelCodingPackages` packages running at once, a second
// package can squash-merge while another is waiting to land. The waiter's
// branch was seeded AND full-gate-validated against an origin/main that no
// longer exists — merging it anyway would land code that was never validated
// against the world it joins (semantic conflicts, broken invariants, silent
// stale-base evidence).
//
// Contract (ADR-0010):
//   1. Every FULL-gate attestation records `baseMainSha` — the origin/main tip
//      the gate ran against. Reuse (--check) is invalid once main moved.
//   2. A branch may be mechanically landed ONLY while it CARRIES current
//      origin/main (`merge-base --is-ancestor <origin/main> <head>`). After a
//      sibling lands, this is false until the branch explicitly reconciles by
//      merging updated origin/main in (a normal merge commit ⇒ new head ⇒
//      fresh FULL gate). No rebases, no force-pushes — ordinary forward merges.
//   3. The mechanical lander enforces admission TWICE: before pushing (fast
//      fail) and immediately before the squash-merge (closing the TOCTOU
//      window while CI ran).
//
// This module holds the pure verdict; callers own their git plumbing.

export const BASE_DRIFT_REASON = 'base-drift';

/**
 * Pure admission verdict for landing one branch (V3-D §11).
 *
 * @param {object} facts gathered by the caller's git plumbing:
 *   currentMainResolved       - true iff origin/main was fetched and resolved
 *   branchContainsCurrentMain - true iff current main is an ancestor of the
 *                               branch head (equal tips count: seeded-at-tip)
 * @returns {{ok:true} | {ok:false, reason:string, detail:string}}
 */
export function landingAdmission({ currentMainResolved, branchContainsCurrentMain }) {
  if (!currentMainResolved) {
    return {
      ok: false,
      reason: BASE_DRIFT_REASON,
      detail:
        'origin/main could not be fetched/resolved — cannot prove the branch carries current main',
    };
  }
  if (!branchContainsCurrentMain) {
    return {
      ok: false,
      reason: BASE_DRIFT_REASON,
      detail:
        'origin/main advanced past the base this branch carries (parallel landing detected). ' +
        'Reconcile first: merge updated origin/main into the branch (normal merge commit ⇒ new head ⇒ fresh FULL gate), then re-run final-land.',
    };
  }
  return { ok: true };
}

/**
 * Whether `ancestorSha` is contained in `descendantSha`. Returns null when
 * git cannot answer (missing refs) so callers can distinguish "no" from
 * "unverifiable" and fail closed.
 */
export function isAncestorSha(runGit, ancestorSha, descendantSha) {
  try {
    runGit('merge-base', '--is-ancestor', ancestorSha, descendantSha);
    return true;
  } catch (e) {
    // exit 1 = "not an ancestor" (a real answer); anything else = unverifiable
    return e?.status === 1 ? false : null;
  }
}
