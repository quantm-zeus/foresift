// Type declarations for deterministic implementation completeness
// (package-implement-complete.mjs). Consumed by the workflow's impl-status /
// impl-recheck / until_bash guards and by convergence-router.mjs (§11).

export interface ImplementationCompleteness {
  complete: boolean;
  errors: string[];
  remainingTasks?: number;
  package?: string;
  tasksCompleted?: number;
}

export declare function implementationComplete(
  packageId: string,
  rootOverride?: string,
): ImplementationCompleteness;
