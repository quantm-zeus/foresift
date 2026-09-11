// Engine handoff for Codex lanes (Hyperdrive H3, P0-4): when a Codex lane
// hits TRUE quota exhaustion (CODEX_QUOTA_EXHAUSTED / CODEX_QUOTA_RESET_WAIT)
// or the selected Codex model is unavailable — as opposed to transient
// capacity contention (POOL_AT_LIMIT / PROVIDER_BACKOFF) which may simply
// wait — the lane can hand off to Claude and execute the SAME logical lane:
//
//   persist ENGINE_HANDOFF → release codex ownership → acquire the Claude
//   permit → run the identical brief in the identical worktree → emit the
//   identical result contract (schema/shardId/role/branch/headSha), with the
//   executing engine recorded as CLAUDE.
//
// Invariants: NO duplicate generation, NO second simultaneous product owner
// (the codex permit is released before the claude permit is acquired — and a
// denied codex acquisition never held one), NO duplicate commits (the lane's
// worktree/branch identity is unchanged), NO duplicate task completion (the
// evidence-backed nomination protocol runs over the actual handoff diff).
//
// Zero AI: this module only decides WHETHER a handoff is warranted and
// executes the deterministic acquire/release choreography. The Claude
// invocation itself is the shared writer core.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acquireLanePermit, releaseLanePermit } from './provider-pool.mjs';
import { claimCompletedUnits, parseTaskGraph } from './writer-task-evidence.mjs';

/** Denial reasons that justify an ENGINE_HANDOFF to Claude. */
export function isQuotaHandoffReason(reason) {
  return (
    reason === 'CODEX_QUOTA_EXHAUSTED' ||
    reason === 'CODEX_QUOTA_RESET_WAIT' ||
    reason === 'REQUIRED_HIGH_MODEL_UNAVAILABLE' ||
    reason?.startsWith?.('CODEX_MODEL_UNAVAILABLE')
  );
}

/** Transient contention: may wait/retry; NOT an immediate handoff trigger. */
export function isTransientContentionReason(reason) {
  return reason === 'POOL_AT_LIMIT' || reason === 'PROVIDER_BACKOFF';
}

/**
 * Persist the handoff record (durable execution truth). Written BEFORE the
 * codex→claude acquire/release choreography so a crash mid-handoff leaves an
 * actionable trace naming the lane and reason.
 */
export function persistHandoffRecord(resultDir, record) {
  writeFileSync(
    join(resultDir, 'engine-handoff.json'),
    `${JSON.stringify(
      {
        schema: 'foresift/engine-handoff@1',
        ...record,
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Execute the handoff: release the codex ownership (if any was ever held —
 * a denied acquisition held nothing), acquire the SAME lane identity on the
 * Claude pool, and invoke `executeWithClaude` (the shared Claude writer core)
 * with the identical logical lane inputs. Returns the executed result or
 * throws (with the claude denial recorded verbatim) when Claude cannot take
 * the lane — the wave treats that exactly like any other lane failure.
 */
export function executeHandoffToClaude({
  stateDir,
  holder,
  packageId,
  generation,
  laneId,
  runId,
  resultDir,
  releaseCodex = true,
  handoffReason = 'codex quota exhausted / model unavailable',
  executeWithClaude,
}) {
  // 1. Durable trace FIRST (crash mid-handoff leaves an actionable record).
  persistHandoffRecord(resultDir, {
    from: 'CODEX',
    to: 'CLAUDE',
    holder,
    reason: handoffReason,
    at: new Date().toISOString(),
  });
  // 2. Atomically release codex ownership BEFORE acquiring claude (never two
  //    simultaneous product owners of the lane; a denied codex acquire held
  //    nothing, and release is a no-op then).
  if (releaseCodex) releaseLanePermit(stateDir, holder, 'codex');
  // 3. Acquire the Claude permit under the SAME holder identity.
  const claudePermit = acquireLanePermit(stateDir, holder, 'claude', {
    packageId,
    generation,
    laneId,
    runId,
  });
  if (!claudePermit.ok) {
    writeFileSync(
      join(resultDir, 'permit-denied.json'),
      `${JSON.stringify(
        {
          schema: 'foresift/lane-permit-denial@1',
          holder,
          provider: 'claude',
          reason: claudePermit.reason,
          waitMs: claudePermit.waitMs,
          handoffFrom: 'codex',
        },
        null,
        2,
      )}\n`,
    );
    throw new Error(`ENGINE_HANDOFF_CLAUDE_PERMIT_DENIED: ${claudePermit.reason}`);
  }
  // 4. Execute the SAME logical lane with Claude, then release the claude
  //    permit in a finally-equivalent path (success, failure, timeout alike).
  //    The shared lane core does NOT release here — the handoff owns the
  //    acquire/release bracket because IT acquired the permit.
  try {
    return executeWithClaude();
  } finally {
    releaseLanePermit(stateDir, holder, 'claude');
  }
}

/**
 * Evidence-backed completion claims for a handed-off lane: nominations run
 * over the handoff's ACTUAL diff with the SAME task list — no duplicate
 * completion, no sibling implication (P0-1 protocol applies unchanged).
 * `unitsById` may be passed directly (tests / callers holding the graph) or
 * derived from `taskGraphPath`; without either, evidence is unavailable and
 * NOTHING is nominated (fail-closed).
 */
export function handoffCompletionClaims({
  taskIds,
  changed,
  taskGraphPath,
  unitsById,
  blockers = [],
}) {
  let resolvedUnits = unitsById ?? null;
  if (!resolvedUnits && taskGraphPath) {
    const parsed = parseTaskGraph(taskGraphPath);
    if (parsed) resolvedUnits = parsed.unitsById;
  }
  return claimCompletedUnits({ taskIds, changed, unitsById: resolvedUnits, blockers });
}
