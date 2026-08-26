// Deterministic OFF/CANARY/PRODUCTION rollout routing for the sharded-wave
// topology (`foresift-sharded-wave`, V4 control-plane optimizer).
//
//   OFF         — no package routes to the sharded wave; every launch keeps
//                 its historical generation/profile workflow (default).
//   CANARY      — only `canaryPackages` route to the sharded wave.
//   PRODUCTION  — every OPTIMIZED-profile package routes to the sharded wave.
//
// Hard invariants:
//   - The LEGACY forensic lane (g0-contracts-data-truth) is NEVER rerouted:
//     `usesOptimizedWorkflow` gates admission upstream, so a retired profile
//     stays retired forever (same discipline as ADR 0007/0009).
//   - Routing is a PURE function of (rollout state, package id). Flips are made
//     exclusively by version-controlled commits of this file.
//
// FLIP SAFETY (why this must be commit-gated): a workflow name is part of the
// Archon run identity — adoption matches (workflow, message). Runs already
// tracked by the supervisor carry their launch workflow in persisted state and
// are immune to a flip; but an UNTRACKED live run launched under the previous
// routing would become invisible to stranded-run reconciliation after a flip,
// risking a duplicate launch. Therefore: flip modes/canaries ONLY when no
// untracked live run exists under the previous routing for any affected
// package (fresh generations, paused packages, or quiescent milestone points).
//
// PRODUCTION activation is gated on the full sharded-wave acceptance evidence
// (V4 §18). That evidence is now RECORDED — see
// `.optimizer-evidence/v4-acceptance-matrix.md`: contract tests, zero
// empty-lane dispatch (A2), red path with bounded repair and checkpoint only
// on genuine green (B1 counter-example preserved / B2), and installed-v0.9
// runtime findings (R1–R7). Fresh waves now resolve a first-class execution
// profile: CODEX_AGY by default or explicit CLAUDE_AGY fallback. AGY owns tests
// only; the historical FORESIFT_AGY_LANES setting cannot route fresh product
// work. Any future rollback remains another version-controlled commit.
//
// Pure functions + Node stdlib only. CLI form prints JSON:
//   node scripts/automation/sharded-wave-rollout.mjs <package-id>

/** @typedef {'OFF'|'CANARY'|'PRODUCTION'} RolloutMode */

/**
 * ACTIVE rollout state: PRODUCTION, authorized by the §18 acceptance matrix.
 * Frozen — runtime mutation is impossible by construction.
 * @type {{mode: RolloutMode, canaryPackages: string[]}}
 */
export const SHARDED_WAVE_ROLLOUT = Object.freeze({
  mode: 'PRODUCTION',
  canaryPackages: Object.freeze([]),
});

/**
 * Whether `packageId` is admitted to the sharded wave under `rollout`.
 * Callers MUST still apply the LEGACY/OPTIMIZED profile boundary
 * (`usesOptimizedWorkflow`) before consulting admission.
 */
export function shardedWaveAdmits(packageId, rollout = SHARDED_WAVE_ROLLOUT) {
  if (!rollout || typeof packageId !== 'string') return false;
  switch (rollout.mode) {
    case 'OFF':
      return false;
    case 'CANARY':
      return Array.isArray(rollout.canaryPackages) && rollout.canaryPackages.includes(packageId);
    case 'PRODUCTION':
      return true;
    default:
      // Unknown mode fails closed: historical routing.
      return false;
  }
}

function main() {
  const id = process.argv[2];
  if (!id || process.argv[3]) {
    console.error('usage: sharded-wave-rollout.mjs <package-id>');
    process.exit(2);
  }
  console.log(
    JSON.stringify({
      packageId: id,
      mode: SHARDED_WAVE_ROLLOUT.mode,
      shardedWaveAdmitted: shardedWaveAdmits(id),
    }),
  );
}

const invokedDirectly = process.argv[1]?.endsWith('sharded-wave-rollout.mjs');
if (invokedDirectly) main();
