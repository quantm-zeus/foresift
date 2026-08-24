// Durable EXECUTION GENERATIONS for Foresift work packages (V3 task spec §6).
//
// Old product runs reused one identity — package id, branch, worktree, run
// message — across every fresh restart, which made "is this the same
// execution?" unanswerable and stale-run adoption dangerous. A generation is a
// durable per-package counter stored in the version-controlled milestone state
// (`packages[].generation`, absent ⇒ 0) that participates in every identity
// surface the supervisor touches:
//
//   branch   gen<=0: foresift/<id>          gen>=1: foresift/<id>-g<gen>
//   message  gen<=0: <id>                   gen>=1: <id>@g<gen>
//
// The MESSAGE doubling as the Archon correlation key is the load-bearing
// choice: runs-table adoption/discovery matches on workflow+message, so a
// generation-N lookup can never adopt a generation-<N row — stale execution
// identities are invisible to fresh ones by construction, not by filtering.
//
// Workflow routing (§8) is generation-aware: generation 0 keeps the historical
// LEGACY/OPTIMIZED profile table (retired g0-contracts-data-truth stays
// LEGACY forever as forensic truth), while EVERY package at generation >= 1
// runs the single final optimized topology. No second optimized workflow copy
// exists; the one `-optimized` workflow evolves in place.
//
// Pure functions + Node stdlib only.

import { throughputProfile } from './work-package-throughput-profile.mjs';
import { SHARDED_WAVE_ROLLOUT, shardedWaveAdmits } from './sharded-wave-rollout.mjs';

/** Generation of a milestone-state package record; absent field ⇒ generation 0. */
export function packageGeneration(pkg) {
  const g = pkg?.generation;
  if (g === undefined || g === null) return 0;
  return g;
}

/** Branch name for a package at the given generation (§6 branch identity). */
export function generationBranch(packageId, generation) {
  return generation > 0 ? `foresift/${packageId}-g${generation}` : `foresift/${packageId}`;
}

/** Archon correlation message for a package at the given generation. */
export function generationMessage(packageId, generation) {
  return generation > 0 ? `${packageId}@g${generation}` : `${packageId}`;
}

/**
 * Parse a message back to its package id + generation. Legacy messages
 * (bare package id) parse to generation 0. Returns null for non-messages.
 */
export function parseGenerationMessage(message) {
  if (typeof message !== 'string' || !message) return null;
  const m = /^(.*)@g(\d+)$/.exec(message);
  if (m) return { packageId: m[1], generation: Number(m[2]) };
  return { packageId: message, generation: 0 };
}

/**
 * Workflow selection (§8): generation-aware profile boundary.
 *   gen >= 1            -> OPTIMIZED_V3 topology (the one -optimized DAG)
 *   gen 0 (legacy rows) -> historical LEGACY/OPTIMIZED profile table
 *
 * Precedence note (V4 layering review): the gen>=1 rule deliberately
 * outranks the profile table — pinned by v3-generations.spec.ts ("regardless
 * of legacy profile"). The LEGACY protection therefore applies to the
 * generation-0 forensic row itself (how g0-contracts-data-truth actually
 * lives); the sharded-wave rollout layered on top inherits exactly this
 * boundary and cannot reroute the retired lane.
 */
export function usesOptimizedWorkflow(pkg) {
  if (!pkg) return false;
  if (packageGeneration(pkg) >= 1) return true;
  return throughputProfile(pkg.id) === 'OPTIMIZED';
}

/**
 * Workflow selection, layered (V4): the LEGACY profile boundary applies first
 * and forever; then the deterministic sharded-wave rollout decides whether an
 * OPTIMIZED-eligible package routes to `foresift-sharded-wave` instead of the
 * single `-optimized` DAG. Ships OFF — see sharded-wave-rollout.mjs for the
 * flip-safety contract.
 */
export function workPackageWorkflowFor(pkg, rollout = SHARDED_WAVE_ROLLOUT) {
  if (!pkg || !usesOptimizedWorkflow(pkg)) return 'foresift-work-package';
  if (shardedWaveAdmits(pkg.id, rollout)) return 'foresift-sharded-wave';
  return 'foresift-work-package-optimized';
}

function main() {
  const id = process.argv[2];
  const gen = Number(process.argv[3]);
  if (!id || !Number.isInteger(gen) || gen < 0 || process.argv[4]) {
    console.error('usage: package-generations.mjs <package-id> <generation>');
    process.exit(2);
  }
  console.log(
    JSON.stringify({
      packageId: id,
      generation: gen,
      branch: generationBranch(id, gen),
      message: generationMessage(id, gen),
      workflow: workPackageWorkflowFor({ id, generation: gen }),
    }),
  );
}

const invokedDirectly = process.argv[1]?.endsWith('package-generations.mjs');
if (invokedDirectly) main();
