// state-landing.d.mts — Type declarations for the protected state landing lane (v2).

export declare const STATE_TRANSITIONS_DIR_NAME: string;
export declare const STATE_WORKTREES_DIR_NAME: string;
export declare const RECEIPT_STATUSES: {
  REQUESTED: 'REQUESTED';
  BRANCH_READY: 'BRANCH_READY';
  BRANCH_PUSHED: 'BRANCH_PUSHED';
  PR_READY: 'PR_READY';
  WAITING_CI: 'WAITING_CI';
  CI_AUTHORIZED: 'CI_AUTHORIZED';
  MERGE_READY: 'MERGE_READY';
  MERGE_REQUESTED: 'MERGE_REQUESTED';
  MERGED: 'MERGED';
  FAILED: 'FAILED';
};

export type ReceiptStatus =
  | 'REQUESTED'
  | 'BRANCH_READY'
  | 'BRANCH_PUSHED'
  | 'PR_READY'
  | 'WAITING_CI'
  | 'CI_AUTHORIZED'
  | 'MERGE_READY'
  | 'MERGE_REQUESTED'
  | 'MERGED'
  | 'FAILED';

export interface DesiredFile {
  path: string;
  content: string;
  contentSha256: string;
}

export interface StateTransitionReceipt {
  schema: 'foresift/state-transition@2';
  transitionId: string;
  logicalTransitionKey: string;
  packageId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  sourceMainSha: string | null;
  desiredFileHash: string | null;
  desiredFiles: DesiredFile[];
  commitMessage: string | null;
  stateBranch: string;
  stateWorktree: string | null;
  prNumber: string | number | null;
  prUrl: string | null;
  authorizedHeadSha: string | null;
  authorizedAt: string | null;
  authorizedCheckName: string | null;
  authorizedAppId: number | null;
  status: ReceiptStatus;
  retryClass: 'RETRYABLE' | 'AUTHORITY_REFUSAL' | 'TERMINAL_CORRUPTION' | null;
  retryCount: number;
  nextRetryAt: string | null;
  mergedSha: string | null;
  failedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StateFileChange {
  path: string;
  content: string;
}

export interface LandStateResult {
  ok: boolean;
  reason?: string;
  receipt?: StateTransitionReceipt | null;
  step?: string;
  pinSha?: string;
}

export interface ValidateStateFilesResult {
  ok: boolean;
  violations: string[];
}

export interface AdoptMergedStateResult {
  adopted: boolean;
  mergedSha: string | null;
  reason?: string;
}

export interface RecoverResult {
  transitionId?: string;
  receipt?: StateTransitionReceipt;
  adopted: boolean;
  advanced?: boolean;
  step?: string;
  mergedSha?: string | null;
  reason?: string;
}

type GhFn = (
  args: string[],
  opts?: { cwd?: string },
) => { ok: boolean; stdout: string; stderr?: string; status?: number };

type GitFn = (
  args: string[],
  opts?: { cwd?: string },
) => { ok: boolean; stdout: string; stderr?: string; status?: number };

export function hashFileChanges(fileChanges: StateFileChange[]): string;

export function readReceipt(stateDir: string, transitionId: string): StateTransitionReceipt | null;

export function validateStateFiles(
  fileChanges: string[] | StateFileChange[],
): ValidateStateFilesResult;

export function discoverPendingReceipts(stateDir: string): StateTransitionReceipt[];

export function verifyMergeAuthoritatively(opts: {
  prNum: string | number;
  pinnedHead: string | null;
  fileChanges: StateFileChange[];
  repoDir: string;
  ghFn?: GhFn;
  gitFn?: GitFn;
}): { ok: boolean; mergeCommitSha?: string; originMainSha?: string; reason?: string };

export function adoptMergedState(opts: {
  receipt: StateTransitionReceipt;
  stateDir: string;
  cwd: string;
  ghFn?: GhFn;
  gitFn?: GitFn;
  log?: (msg: string) => void;
}): AdoptMergedStateResult;

export function advanceStateTransition(opts: {
  receipt?: StateTransitionReceipt | null;
  fileChanges?: StateFileChange[];
  message?: string;
  stateDir: string;
  repoDir: string;
  packageId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  repo?: string;
  checkName?: string;
  requiredAppId?: number;
  ghFn?: GhFn;
  gitFn?: GitFn;
  log?: (msg: string) => void;
}): LandStateResult;

export function recoverPendingStateLandings(opts: {
  stateDir: string;
  repoDir?: string;
  cwd?: string;
  repo?: string;
  checkName?: string;
  requiredAppId?: number;
  ghFn?: GhFn;
  gitFn?: GitFn;
  log?: (msg: string) => void;
}): RecoverResult[];
