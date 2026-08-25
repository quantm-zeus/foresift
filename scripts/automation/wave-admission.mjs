// Launch-seam wave-admission decision (defect #18).
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
// package takes `foresift-work-package-optimized` — the topology whose Phase-1
// router plans first. Nothing is weakened: both topologies are accepted
// production workflows; the FULL gate stays downstream either way.

/** Workflow an unplanned package falls back to (embeds the Phase-1 planner). */
export const PLANNING_WORKFLOW = 'foresift-work-package-optimized';

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
  if (planningComplete !== true) return PLANNING_WORKFLOW;
  return selectorWorkflow;
}
