// Parallelism quality gate (directive 2026-09-06 §5, canary).

export declare const SERIAL_REASONS: readonly string[];
export declare const REPORT_SCHEMA: string;

export interface ParallelismAuditMissed {
  taskId: string;
  disjointWith: string[];
}

export interface ParallelismAuditReport {
  schema: string;
  missed: ParallelismAuditMissed[];
}

/**
 * A PRODUCT unit that is not [P], carries no [serial-reason: …] exemption,
 * and has ≥1 open sibling with exact disjoint predicted/test writes and no
 * direct dependency edge either way is a MISSED_PARALLELISM_OPPORTUNITY.
 * Unknown serial-reason values throw SERIAL_REASON_UNKNOWN (fail closed).
 */
export declare function missedParallelismOpportunities(graph: {
  units?: Array<{
    id: string;
    done?: boolean;
    executor?: string;
    parallelizable?: boolean;
    body?: string;
    productWrites?: string[];
    testWrites?: string[];
    predictedWrites?: string[];
    dependsOn?: string[];
    [k: string]: unknown;
  }>;
}): ParallelismAuditMissed[];
