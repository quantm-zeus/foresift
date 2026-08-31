// Adaptive lane count (Hyperdrive H3, P2-10): deterministic, zero-AI shard
// count resolution from parallelizable work truth, exact preflight need,
// governor state, and provider permit capacity. Missing truth degrades to
// the policy default; never an expansion.

export declare const ADAPTIVE_LANES_SCHEMA: string;
export declare const LANE_COUNT_LIMITS: { min: number; max: number; default: number };

export declare function resolveAdaptiveLaneCount(input?: {
  openTaskCount?: number;
  parallelizableCount?: number;
  disjointShardNeed?: number | null;
  governorState?: string;
  codexLimit?: number;
  claudeLimit?: number;
}): { schema: string; lanes: number; reason: string; capped: boolean };
