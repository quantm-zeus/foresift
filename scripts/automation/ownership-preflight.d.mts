// Directive 2026-09-07 (live VPS verification) — ownership-routing preflight.

export declare const REPORT_SCHEMA: undefined; // pure audit module, no report file

/**
 * Deterministic preflight: which OPEN implementation-dispatched units carry
 * test-owned writes? Returns error messages (empty = schedulable as routed).
 */
export declare function implementationAdmissionErrors(graph: {
  units?: Array<{
    id: string;
    done?: boolean;
    executor?: string;
    predictedWrites?: string[];
    testWrites?: string[];
    [k: string]: unknown;
  }>;
  shards?: Array<{ mode?: string; units?: string[]; [k: string]: unknown }>;
}): string[];

/** Hard variant used by the graph builder: throws OWNERSHIP_ADMISSION_FAILED. */
export declare function assertImplementationAdmission(graph: {
  units?: Array<{
    id: string;
    done?: boolean;
    executor?: string;
    predictedWrites?: string[];
    testWrites?: string[];
    [k: string]: unknown;
  }>;
  shards?: Array<{ mode?: string; units?: string[]; [k: string]: unknown }>;
}): void;

/** Repo-local git identity commands pinning the LANE identity at creation. */
export declare function laneGitIdentityCommands(lane: string): string[];
