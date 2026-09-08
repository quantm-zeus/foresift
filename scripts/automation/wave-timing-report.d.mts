// Wave phase-split timing telemetry (directive 2026-09-06 §6).

export declare const REPORT_SCHEMA: string;

export interface WaveTimingPhase {
  id: 'prep' | 'reconciliation' | 'parallelism_audit' | 'lanes' | 'fast';
  seconds: number | null;
  present: boolean;
  lanes?: Array<{
    lane: string;
    outcome: string;
    wallTimeMs: number | null;
    engine: string | null;
    handedOffFrom: string | null;
  }>;
  writerWallTimeMs?: number | null;
  verdict?: unknown;
}

export interface WaveTimingReport {
  schema: string;
  phases: WaveTimingPhase[];
  /** Sum of KNOWN phase durations only; absent phases never contribute. */
  accountedSeconds: number;
}

/**
 * Join one wave run's artifacts into a phase-split wall-clock table (zero AI,
 * pure mtime/JSON arithmetic; absent optional artifacts yield present:false
 * with a null duration — never fabricated, never thrown).
 */
export declare function waveTimingReport(ctx: { root: string }): WaveTimingReport;
