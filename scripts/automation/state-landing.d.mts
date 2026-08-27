// state-landing.d.mts — Type declarations for the protected state landing lane.

export declare const STATE_TRANSITIONS_DIR_NAME: string;
export declare const STATE_WORKTREES_DIR_NAME: string;

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
  receipt?: StateTransitionReceipt | null;
  step?: string;
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
  mergedSha?: string | null;
  reason?: string;
}

export function validateStateFiles(
  fileChanges: string[] | StateFileChange[],
): ValidateStateFilesResult;

export function discoverPendingReceipts(stateDir: string): StateTransitionReceipt[];

export function adoptMergedState(opts: {
  receipt: StateTransitionReceipt;
  fileChanges?: StateFileChange[];
  stateDir: string;
  cwd: string;
  ghFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
  gitFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
  log?: (msg: string) => void;
}): AdoptMergedStateResult;

export function advanceStateTransition(opts: {
  receipt?: StateTransitionReceipt | null;
  fileChanges: StateFileChange[];
  message: string;
  stateDir: string;
  repoDir: string;
  packageId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  repo?: string;
  checkName?: string;
  requiredAppId?: number;
  ghFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
  gitFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
  log?: (msg: string) => void;
}): LandStateResult;

export function recoverPendingStateLandings(opts: {
  stateDir: string;
  cwd: string;
  ghFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
  gitFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
  log?: (msg: string) => void;
}): RecoverResult[];

export function landStateViaPR(opts: {
  fileChanges: StateFileChange[];
  message: string;
  stateDir: string;
  repoDir: string;
  packageId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  repo?: string;
  checkName?: string;
  requiredAppId?: number;
  deadlineMs?: number;
  pollMs?: number;
  ghFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
  gitFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
  log?: (msg: string) => void;
}): LandStateResult;
