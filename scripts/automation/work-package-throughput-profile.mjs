#!/usr/bin/env node
// Deterministic LEGACY/OPTIMIZED throughput-profile selection (task spec §8).
//
//   g0-contracts-data-truth => LEGACY      (the already-running logical G0
//                                           package keeps its behavioral
//                                           implementation profile forever)
//   every other package     => OPTIMIZED   (coherent slices, checkpoints,
//                                           FAST/FULL verification tiers,
//                                           proven-only verification dedupe)
//
// This is an explicit deterministic mechanism — no reliance on undocumented
// Archon snapshot behavior, no second orchestrator. Pure function first; CLI
// form prints JSON for bash nodes:
//
//   node scripts/automation/work-package-throughput-profile.mjs <package-id>
//
export function throughputProfile(packageId) {
  if (packageId === 'g0-contracts-data-truth') return 'LEGACY';
  return 'OPTIMIZED';
}

export function isOptimized(packageId) {
  return throughputProfile(packageId) === 'OPTIMIZED';
}

function main() {
  const id = process.argv[2];
  if (!id || process.argv[3]) {
    console.error('usage: work-package-throughput-profile.mjs <package-id>');
    process.exit(2);
  }
  console.log(JSON.stringify({ packageId: id, profile: throughputProfile(id) }));
}

const invokedDirectly = process.argv[1]?.endsWith('work-package-throughput-profile.mjs');
if (invokedDirectly) main();
