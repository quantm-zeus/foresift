// Pre-provider already-satisfied reconciliation (directive 2026-09-06 §4):
// deterministic trusted-ancestry audit of OPEN FILE_OUTPUT units BEFORE any
// writer/provider dispatch. Fail-closed; zero AI. See the .mjs for the laws.

export declare const REPORT_SCHEMA: string;

export interface PreProviderReconciliationInput {
  units?: Array<{
    id: string;
    done?: boolean;
    evidence?: string;
    predictedWrites?: string[];
    [k: string]: unknown;
  }>;
  bound?: { mainHeadSha?: string | null } & Record<string, unknown>;
  [k: string]: unknown;
}

export interface PreProviderReconciliationReport {
  schema: string;
  packageId: string;
  atHead: string;
  trustedBase: string | null;
  reconciled: string[];
  decisions: Array<{
    taskId: string;
    proof: string;
    fileProof?: Array<{ path: string; authoringCommit: string }>;
  }>;
  blocked: Array<{ taskId: string; reason: string }>;
  outOfScope: string[];
  commit?: string;
}

/**
 * Reconcile already-satisfied FILE_OUTPUT units on the canonical tree BEFORE
 * provider acquisition: checkbox closed as NO_OP_ALREADY_SATISFIED in ONE
 * coordinator commit (unless ctx.commit === false); missing output / base-
 * fixture authorship fail closed and stay OPEN. Writes the machine-readable
 * report when ctx.reportPath is given.
 */
export declare function preProviderReconciliation(
  graph: PreProviderReconciliationInput,
  ctx: {
    root: string;
    packageId: string;
    reportPath?: string;
    commit?: boolean;
  },
): PreProviderReconciliationReport;
