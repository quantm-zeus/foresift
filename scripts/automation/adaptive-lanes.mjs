// Adaptive lane count + AGY parallelism (Hyperdrive H3, P2-10).
//
// The wave's shard count must NOT be a static operator constant: it is
// derived deterministically (zero AI) from the actual parallelizable work,
// the exact write-truth preflight, host governor state, and provider permit
// capacity. A wave with 2 disjoint [P] tasks never needs 3 writer lanes; a
// YELLOW/RED host never expands concurrency. The task-graph planner already
// drops empty groups, so an over-generous N only wastes planning, not
// providers — but an under-considered N starves throughput, and an expanded
// N under pressure OOMs hosts. This advisor picks the SMALLEST N that covers
// the genuinely disjoint parallel work under current capacity, and never
// exceeds the policy ceiling.
//
// All inputs are optional-safe: missing truth degrades to the policy default
// (never an expansion).

export const ADAPTIVE_LANES_SCHEMA = 'foresift/adaptive-lanes@1';

export const LANE_COUNT_LIMITS = Object.freeze({ min: 1, max: 3, default: 3 });

/**
 * Resolve the adaptive writer-lane count for ONE wave launch.
 *
 * @param {object} input
 * @param {number} [input.openTaskCount]          open units in the graph
 * @param {number} [input.parallelizableReadyCount] [P] open units whose
 *   dependencies are satisfied (authoritative)
 * @param {number} [input.parallelizableCount]    raw [P] open units (legacy
 *   alias for parallelizableReadyCount when the caller pre-filters)
 * @param {number} [input.disjointShardNeed]      shard count already proven
 *   necessary by an exact preflight (optional refinement)
 * @param {string} [input.governorState]          GREEN|YELLOW|ORANGE|RED
 * @param {number} [input.codexLimit]             current codex pool limit
 * @param {number} [input.claudeLimit]            current claude pool limit
 * @returns {{schema, lanes: number, reason: string, capped: boolean}}
 */
export function resolveAdaptiveLaneCount(input = {}) {
  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const openTaskCount = num(input.openTaskCount);
  // READY work truth (H3 P0): parallelizability is judged over units whose
  // dependencies are satisfied — dependency/phase-blocked units must never
  // be counted as immediately parallel-ready. parallelizableCount alone (the
  // raw [P] population) stays supported for callers that pre-filter, but the
  // authoritative input is parallelizableReadyCount.
  const parallelizableCount = num(input.parallelizableReadyCount ?? input.parallelizableCount);
  const disjointShardNeed = input.disjointShardNeed == null ? null : num(input.disjointShardNeed);
  const governorState = String(input.governorState ?? 'GREEN').toUpperCase();
  const codexLimit = num(input.codexLimit, 0);
  const claudeLimit = num(input.claudeLimit, 0);

  // Base need: the serial core always exists when there is READY product
  // work; an additional lane earns its slot only when MORE than one genuinely
  // parallel-READY unit exists (a single [P] unit runs beside the core
  // without a dedicated lane). Zero open work (openTaskCount 0 with no ready
  // units) collapses to the minimum — a wave over an empty graph plans
  // nothing. Disjoint-shard truth (exact preflight) overrides the heuristic
  // when derivable.
  const heuristicNeed =
    openTaskCount === 0 && parallelizableCount === 0
      ? 0
      : 1 + Math.min(Math.max(parallelizableCount - 1, 0), LANE_COUNT_LIMITS.max - 1);
  const need =
    disjointShardNeed != null
      ? Math.max(1, Math.min(disjointShardNeed, LANE_COUNT_LIMITS.max))
      : heuristicNeed;

  // Host governor: no concurrency increase at YELLOW; ORANGE/RED collapse to
  // the minimum viable lane (the serial core must still run or nothing moves).
  let capped = false;
  let cap = LANE_COUNT_LIMITS.max;
  if (governorState === 'YELLOW') {
    cap = 1;
    capped = true;
  } else if (governorState === 'ORANGE' || governorState === 'RED') {
    cap = 1;
    capped = true;
  }

  // Provider permits: lanes beyond permit capacity cannot dispatch anyway.
  // Absent permit truth (both limits missing/non-finite) does NOT cap — an
  // unknown pool never degrades throughput, the per-lane permit broker still
  // gates every dispatch. Only PRESENT truth caps.
  const hasPermitTruth = codexLimit > 0 || claudeLimit > 0;
  if (hasPermitTruth) {
    const providerCap = Math.max(codexLimit + claudeLimit, 1);
    if (providerCap < cap) {
      cap = providerCap;
      capped = true;
    }
  }

  const lanes = Math.max(LANE_COUNT_LIMITS.min, Math.min(need, cap));
  const reason =
    governorState !== 'GREEN'
      ? `governor ${governorState} caps lanes at ${cap}`
      : hasPermitTruth && Math.max(codexLimit + claudeLimit, 1) < need
        ? `provider capacity ${Math.max(codexLimit + claudeLimit, 1)} caps lanes at ${cap}`
        : disjointShardNeed != null
          ? `exact preflight needs ${need} shard(s)`
          : `${parallelizableCount} parallelizable unit(s) → ${need} lane(s)`;
  return { schema: ADAPTIVE_LANES_SCHEMA, lanes, reason, capped: capped || lanes < need };
}
