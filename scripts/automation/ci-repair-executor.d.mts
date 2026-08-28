// ci-repair-executor.d.mts — Type declarations for the bounded CI repair router.

/** Maximum total repair attempts before mandatory escalation. */
export declare const MAX_REPAIR_ATTEMPTS: number;

/** Infrastructure retry budget (bounded, zero AI). */
export declare const MAX_INFRA_RETRIES: number;

/** Maximum number of files FORMAT repair is allowed to touch per attempt. */
export declare const MAX_FORMAT_FILES: number;

export interface FormatRepairResult {
  ok: boolean;
  reason?: string;
  requestId?: string;
  newHead: string | null;
}

export interface InfraRetryResult {
  ok: boolean;
  waitMs: number;
  reason: string;
}

export interface CiRepairResult {
  action: string;
  engine: string;
  result: string;
  newHead: string | null;
  retry: boolean;
  escalate: boolean;
  waitMs?: number;
  reason?: string;
  routeInstruction?: {
    route: string;
    engine: string;
    files?: string[];
    reason?: string;
  };
}

/**
 * Load the current repair attempt count from an incident capsule file.
 * Returns 0 if the file does not exist or has no repairAttempts field.
 */
export function loadRepairAttempts(filePath: string): number;

/**
 * Increment the repair attempt counter in a capsule file and return the new count.
 */
export function incrementRepairAttempts(filePath: string): number;

/**
 * Execute a deterministic Prettier format repair on whitelisted state files.
 * ZERO AI. Only safe (state-only whitelist) paths are touched.
 *
 * Returns { ok: true, newHead } on success, { ok: false, reason } on failure.
 */
export function executeFormatRepair(opts: {
  failedFiles: string[];
  classification?: unknown;
  failureSummary?: string | null;
  prChangedFiles?: string[];
  worktreeDir: string;
  branch: string;
  log?: (msg: string) => void;
}): FormatRepairResult;

/**
 * Execute an infrastructure retry (bounded backoff, ZERO AI).
 * Returns { ok: true, waitMs } if within budget, { ok: false, reason } if exhausted.
 */
export function executeInfraRetry(opts: { attempt: number; maxRetries?: number }): InfraRetryResult;

/**
 * Main repair router: reads the incident capsule's repairRoute and executes
 * the appropriate bounded repair. Returns a CiRepairResult describing what happened.
 *
 * FORMAT → deterministic prettier, zero AI, scope-verified before commit
 * INFRA → bounded backoff retry, zero AI
 * CODEX/AGY → persist a durable request for the existing supervisor consumer
 * SPEC → escalate without invoking a repair writer
 * ESCALATE → after budget exhaustion
 */
export function executeCiRepair(opts?: {
  incident?: {
    capsule: {
      sha?: string;
      repairRoute?: { route?: string; engine?: string };
      classification?: { category?: string; failedFiles?: string[] };
      repairAttempts?: number;
    };
    filePath?: string | null;
  } | null;
  branch?: string;
  worktreeDir?: string;
  executionProfile?: string;
  stateDir?: string;
  log?: (msg: string) => void;
}): CiRepairResult;

export interface RepairRequest {
  schema: string;
  requestId?: string;
  incidentId: string;
  packageId: string | null;
  prNumber: number | string | null;
  baseSha: string | null;
  failedHeadSha: string;
  branch: string;
  worktreeDir: string | null;
  executionProfile: string;
  route: string;
  engine: string;
  failedFiles: string[];
  prChangedFiles: string[];
  allowedWritePaths?: string[];
  attemptCount: number;
  status:
    | 'PENDING'
    | 'WORKTREE_READY'
    | 'ENGINE_INVOCATION_STARTED'
    | 'ENGINE_INVOKED'
    | 'OWNERSHIP_VERIFIED'
    | 'COMMITTED'
    | 'PUSHED'
    | 'COMPLETE'
    | 'FAILED';
  newHeadSha: string | null;
  engineResult?: unknown;
  failureReason?: string;
  createdAt: string;
  updatedAt?: string;
}

export function persistRepairRequest(stateDir: string, request: RepairRequest): string;
export function discoverPendingRepairRequests(
  stateDir: string,
): { request: RepairRequest; path: string }[];
export function validateRepairOwnership(opts: { engine: string; actualDiffPaths: string[] }): {
  ok: boolean;
  violations: string[];
  violationType: string | null;
};
export function advanceRepairRequest(opts: {
  request: RepairRequest;
  stateDir: string;
  repoDir: string;
  executorFn?: (req: RepairRequest) => Promise<void>;
  log?: (msg: string) => void;
}): Promise<{ action: string; violations?: string[]; status?: string }>;
