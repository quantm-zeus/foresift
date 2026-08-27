// state-landing.d.mts — Type declarations for the protected state landing lane.

export declare const STATE_TRANSITIONS_DIR_NAME: string;

export interface StateTransitionReceipt {
  schema: 'foresift/state-transition@1';
  transitionId: string;
  package: string | null;
  from: string | null;
  to: string | null;
  sourceSha: string | null;
  stateBranch: string;
  pr: string | number | null;
  prUrl: string | null;
  desiredFileHash: string | null;
  status: 'pending' | 'branch_created' | 'pr_created' | 'ci_green' | 'merged' | 'failed';
  mergedSha: string | null;
  createdAt: string;
  updatedAt: string;
  failedReason?: string;
}

export interface StateFileChange {
  path: string;
  content: string;
}

export interface LandStateResult {
  ok: boolean;
  reason?: string;
  receipt?: StateTransitionReceipt;
}

export interface ValidateStateFilesResult {
  ok: boolean;
  violations: string[];
}

export interface AdoptMergedStateResult {
  adopted: boolean;
  mergedSha: string | null;
}

export interface RecoverResult {
  transitionId: string;
  adopted: boolean;
  mergedSha?: string | null;
  reason?: string;
}

/**
 * Validate that all file paths are on the state-only whitelist.
 * Accepts either string paths directly or StateFileChange objects.
 * Returns { ok: true } if all paths are allowed, or { ok: false, violations: [...] } otherwise.
 */
export function validateStateFiles(
  fileChanges: string[] | StateFileChange[],
): ValidateStateFilesResult;

/**
 * Discover all non-terminal (pending, branch_created, pr_created, ci_green) receipts.
 */
export function discoverPendingReceipts(stateDir: string): StateTransitionReceipt[];

/**
 * Check whether a receipt's PR has since been merged.
 * Returns { adopted: true, mergedSha } if merged, { adopted: false } otherwise.
 */
export function adoptMergedState(opts: {
  receipt: StateTransitionReceipt;
  stateDir: string;
  cwd: string;
  ghFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string };
}): AdoptMergedStateResult;

/**
 * On supervisor startup, discover pending state-transition receipts and attempt
 * to adopt their merged results (crash recovery).
 */
export function recoverPendingStateLandings(opts: {
  stateDir: string;
  cwd: string;
  log: (msg: string) => void;
}): RecoverResult[];

/**
 * Protected state landing lane: creates a temp branch, applies state file changes,
 * pushes, creates a PR, waits for CI, and squash-merges.
 *
 * HARD LAW: This is the ONLY path for normal autopilot state mutations.
 * No direct push to main is permitted.
 */
export function landStateViaPR(opts: {
  fileChanges: StateFileChange[];
  message: string;
  stateDir: string;
  repoDir: string;
  packageId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  log?: (msg: string) => void;
  ghFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string };
}): LandStateResult;
