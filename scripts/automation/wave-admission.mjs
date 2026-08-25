// Launch-seam wave-admission decision (defect #18) + planned-handoff routing
// (post-planning throughput gap).
//
// `foresift-sharded-wave` is an IMPLEMENTATION-only topology: its prep reads
// scoped plan/tasks authority (`specs/<pkg>/tasks.md`) that only a planning
// phase creates. Under PRODUCTION rollout routing every OPTIMIZED-profile
// package was admitted to the wave — including never-planned PENDING packages,
// whose first live launch died deterministically at prep ("cannot read …
// tasks.md", run 4d8113dd). The pure selector stays pure by design
// (sharded-wave-rollout.mjs flip-safety contract); the environment-dependent
// half of the decision lives HERE and is applied strictly at LAUNCH time,
// before any run exists, so persisted launch identity / adoption matching are
// untouched.
//
// Fail-closed direction: when planning truth cannot be proven complete, the
// package takes `foresift-package-planning-bootstrap` — a bounded planning-
// ONLY variant of the optimized topology (Phases 0A–1 verbatim, zero
// implementation nodes). Once its deterministic validator reports complete,
// that execution TERMINATES and the supervisor reselects the same still-RUNNING
// package into the sharded wave (planning handoff). Demoting to the FULL
// optimized topology instead would let an unplanned-origin package continue
// into optimized implementation forever, permanently bypassing wave routing —
// exactly the gap the handoff closes. Nothing is weakened: the bootstrap runs
// the identical planner loop and guard as the optimized Phase 1; the FULL gate
// stays downstream in whichever topology implements.
//
// Legacy preservation: only WAVE-selector launches can demote here. Under
// OFF/CANARY rollout states (and for the LEGACY-profile package), the selector
// itself returns the optimized/original topology and this module never
// interferes — direct invocations of `foresift-work-package-optimized` keep
// their full historical plan→implement→gate lifecycle unchanged.

/** The implementation-only planning bootstrap (optimized Phases 0A–1 + terminal). */
export const PLANNING_BOOTSTRAP_WORKFLOW = 'foresift-package-planning-bootstrap';

/** The full optimized topology (plans AND implements in one execution). */
export const OPTIMIZED_WORKFLOW = 'foresift-work-package-optimized';

/**
 * Historical alias: before the planned-handoff law, unplanned packages fell
 * back to the full optimized topology. Kept exported because recovery tooling
 * and older tracking rows still reference it.
 */
export const PLANNING_WORKFLOW = OPTIMIZED_WORKFLOW;

/** The implementation-only topology whose admission this module gates. */
export const WAVE_WORKFLOW = 'foresift-sharded-wave';

/**
 * Resolve the workflow a package may be LAUNCHED with.
 *
 * @param {string} selectorWorkflow — verdict of the pure generation/profile/
 *   rollout selector (`workPackageWorkflowFor`) for this package.
 * @param {boolean} planningComplete — deterministic repo-scoped planning
 *   completeness (package-plan-complete.mjs --repo-only). Callers MUST treat
 *   "could not evaluate" as false.
 * @returns {string} the workflow to launch under.
 */
export function admitWorkflowForLaunch(selectorWorkflow, planningComplete) {
  if (selectorWorkflow !== WAVE_WORKFLOW) return selectorWorkflow;
  if (planningComplete !== true) return PLANNING_BOOTSTRAP_WORKFLOW;
  return selectorWorkflow;
}
