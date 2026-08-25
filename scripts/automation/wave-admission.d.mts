// Type declarations for wave-admission.mjs (launch-seam wave admission, defect #18).

/** Workflow an unplanned package falls back to (embeds the Phase-1 planner). */
export declare const PLANNING_WORKFLOW: 'foresift-work-package-optimized';

/** The implementation-only topology whose admission this module gates. */
export declare const WAVE_WORKFLOW: 'foresift-sharded-wave';

/**
 * Resolve the workflow a package may be LAUNCHED with: the pure selector's
 * verdict, demoted to `foresift-work-package-optimized` when the package is
 * wave-routed but its repo-scoped planning completeness is not proven true.
 */
export declare function admitWorkflowForLaunch(
  selectorWorkflow: string,
  planningComplete: boolean,
): string;
