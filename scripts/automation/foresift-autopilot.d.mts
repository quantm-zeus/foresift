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
