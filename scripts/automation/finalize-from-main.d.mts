// Type declarations for deterministic fail-closed package finalization
// (finalize-from-main.mjs). Consumed by foresift-autopilot.mjs
// `--finalize-from-main <package-id>` (defect #16 follow-up).

export interface MergedPrEvidence {
  number: number;
  title: string;
  url: string;
  mergeCommitOid: string;
}

export interface FinalizationEvidence {
  packageId: string;
  mainSha: string | null;
  pr?: { number: number; url: string; mergeCommit: string };
  ci?: { databaseId: number; url?: string };
  taskBoxes?: number;
  deferredNonScopeItems?: number;
}

export interface FinalizationVerdict {
  ok: boolean;
  reasons: string[];
  evidence: FinalizationEvidence;
}

export interface ScopedTaskScan {
  boxes: number;
  uncheckedT: string[];
  deferred: string[];
}

export declare function titleCarriesPackage(packageId: string, title: unknown): boolean;
export declare function scanScopedTasks(tasksText: unknown): ScopedTaskScan;
export declare function evaluateFinalizationFromMain(
  facts: Record<string, unknown>,
): FinalizationVerdict;
export declare function collectFinalizationFacts(
  packageId: string,
  repo: string,
  extra?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
