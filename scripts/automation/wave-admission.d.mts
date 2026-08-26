// Type declarations for wave-admission.mjs (launch-seam wave admission,
// defect #18; planned-handoff demotion target, post-planning throughput gap).

/** The implementation-only planning bootstrap (optimized Phases 0A–1 + terminal). */
export declare const PLANNING_BOOTSTRAP_WORKFLOW: 'foresift-package-planning-bootstrap';

/** The full optimized topology (plans AND implements in one execution). */
export declare const OPTIMIZED_WORKFLOW: 'foresift-work-package-optimized';

/** Historical alias for OPTIMIZED_WORKFLOW (pre-handoff demotion target). */
export declare const PLANNING_WORKFLOW: 'foresift-work-package-optimized';

/** The implementation-only topology whose admission this module gates. */
export declare const WAVE_WORKFLOW: 'foresift-sharded-wave';

/**
 * Resolve the workflow a package may be LAUNCHED with: the pure selector's
 * verdict, demoted to `foresift-package-planning-bootstrap` when the package
 * is wave-routed but its repo-scoped planning completeness is not proven true.
 */
export declare function admitWorkflowForLaunch(
  selectorWorkflow: string,
  planningComplete: boolean,
): string;
