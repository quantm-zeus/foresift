/** Normalize an Archon timestamp (epoch-ms number, other numeric epoch,
 *  numeric string, or ISO string with space/T separator; missing TZ ⇒ UTC)
 *  to epoch milliseconds. Returns null when unparsable. */
export declare function normalizeTimestampMs(v: unknown): number | null;

/** Best-effort observability for a run from Archon's structured JSONL event
 *  log: currently open DAG node, its loop-iteration count, and last event ts.
 *  Returns null when the log is absent/unreadable — advisory only, never throws. */
export interface RunObservability {
  currentNode: string | null;
  iteration: number | null;
  nodeStarts: Record<string, number>;
  lastEventAt: number | null;
}
export declare function runObservability(runId: unknown): RunObservability | null;

export interface AutopilotStatus {
  lines: string[];
}
/** Render the operator status report (also printed by `--status`). */
export declare function buildStatus(): string;

/** Verify that a `workflow resume` actually restarted a run (row left the
 *  terminal/paused state, or its activity timestamp advanced past the resume
 *  moment) instead of silently doing nothing. Polls a bounded window;
 *  `opts.getRow`/`tries`/`gapMs` are test hooks. */
export interface ResumeVerifyOptions {
  tries?: number;
  gapMs?: number;
  getRow?: (id: string) => unknown;
}
export declare function resumeTookEffect(
  runId: string,
  resumeStartedAt: number,
  opts?: ResumeVerifyOptions,
): boolean;

/** V3-B §18 adaptive handoff cadence (ms) — see nextPollDelayMs. */
export declare const POLL_INTERVAL_MS: number;
export declare const HANDOFF_POLL_MS: number;
export declare const HANDOFF_FAST_STREAK_MAX: number;

/** Pure handoff-cadence decision: fast-poll right after a tick launched work,
 *  while run-id discovery is pending, while ACTIVE work is tracked, or while
 *  the ready queue is non-empty (§49); bounded by the fast streak, base
 *  interval for a fully quiet project. Deterministic and total. */
export interface PollDecision {
  delayMs: number;
  fastStreak: number;
}
export declare function nextPollDelayMs(opts?: {
  launched?: number;
  awaitingDiscovery?: boolean;
  fastStreak?: number;
  activeWork?: boolean;
  readyWork?: boolean;
}): PollDecision;

/** Defect #11: milestone state as committed at HEAD (the only baseline a
 *  freshly materialized run worktree can inherit); null when unreadable. */
export declare function loadCommittedMilestone(cwd?: string): unknown;

/** Defect #11: resolve the view launch decisions may use. Returns the
 *  validated committed milestone, or null + reason when selection must
 *  defer (uncommitted chore flips must never drive launches). */
export declare function selectionView(
  fileMs: unknown,
  committedMs: unknown,
): { ms: unknown; why: string };

/** Defect #11b: archon's per-task run-worktree branch name for a launch
 *  branch (`foresift/<pkg>` → `archon/task-foresift-<pkg>`). */
export declare function archonTaskBranchName(branch: string): string;

/** Defect #11b: locate archon's reused run worktree for a launch branch by
 *  its naming convention; null when none is registered. */
export declare function findArchonTaskWorktree(
  branch: string,
  cwd?: string,
): { path: string } | { error: string } | null;

/** Defect #11b: fast-forward the reused task worktree to origin/main before a
 *  fresh launch (strict-FF, clean-tree, fail-closed guards). */
export declare function advanceArchonTaskWorktree(
  branch: string,
  cwd?: string,
): Record<string, unknown> | null;

/** H3 P2-10/P1-7: launch a detached archon workflow run. For the sharded wave
 *  the writer-lane count is resolved adaptively (work truth + governor +
 *  permits) and exported as FORESIFT_WRITERS unless the operator pinned one;
 *  the env is restored after the launch. */
export declare function launchDetached(
  st: unknown,
  workflow: string,
  branch: string,
  message: string,
  executionProfile?: string | null,
): unknown;
