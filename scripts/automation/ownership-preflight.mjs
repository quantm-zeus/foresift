// Ownership-routing preflight (directive 2026-09-07, live VPS verification).
//
// Live evidence (run b659eef0, g1-capacity-contracts): writer-serial-1/2 died
// ×3 on CLAUDE_TEST_OWNERSHIP_VIOLATION because their tasks bundle colocated
// tests with product code — the ownership guard is RIGHT, the PLAN was
// unschedulable, and the failure surfaced only after the provider spend was
// sunk. This module makes the law deterministic and EARLY:
//
//   1. implementationAdmissionErrors(graph): every OPEN unit dispatched to an
//      implementation shard that carries TEST-classified writes (testWrites
//      plus test paths hiding in predictedWrites) is a hard preflight error
//      naming the unit, the violating paths, and the fix (split test work
//      into a test-owned task). Coordinator executor units are exempt — the
//      coordinator owns mechanical bookkeeping by law. Pure audit: no
//      mutation, no dispatch.
//   2. laneGitIdentityCommands(lane): the repo-local git identity commands a
//      worktree must be pinned with at creation, so lane commits never use
//      the ambient user identity.
//
// The task-graph builder calls assertImplementationAdmission at build time —
// before the graph is emitted and long before any writer/provider work.
import { classifyOwnedPath } from './path-ownership.mjs';

const TEST_PATH_PATTERNS = [
  /^tests\//,
  /(^|\/)__tests__\//,
  /(^|\/)test\//,
  /(^|\/)fixtures\//,
  /(^|\/)test-helpers?\//,
  /\.(?:test|spec)\.[^/]+$/,
];

const isTestPath = (p) => TEST_PATH_PATTERNS.some((re) => re.test(p));

/**
 * Deterministic preflight: which OPEN implementation-dispatched units carry
 * test-owned writes? Returns an array of error messages (empty = plan is
 * schedulable as routed). Never throws for plan defects — the caller (graph
 * builder) decides how loudly to fail.
 */
export function implementationAdmissionErrors(graph) {
  const unitsById = new Map((graph?.units ?? []).map((u) => [u.id, u]));
  const dispatched = new Set(
    (graph?.shards ?? []).flatMap((s) =>
      s.mode === 'parallel' || s.mode === 'serial' ? (s.units ?? []) : [],
    ),
  );
  const errors = [];
  for (const id of dispatched) {
    const u = unitsById.get(id);
    if (!u || u.done) continue;
    if ((u.executor ?? 'PRODUCT') === 'COORDINATOR') continue; // coordinator-owned bookkeeping
    const violating = [...new Set([...(u.testWrites ?? []), ...(u.predictedWrites ?? [])])]
      .filter((p) => classifyOwnedPath(p) === 'TEST' || isTestPath(p))
      .sort();
    if (violating.length === 0) continue;
    errors.push(
      `IMPLEMENTATION_LANE_TEST_WRITES: ${u.id} is dispatched to an implementation lane but carries test-owned ` +
        `writes (${violating.join(', ')}) — the ownership guard legally refuses such lanes after provider spend ` +
        `(live b659eef0: writer-serial-1/2 died ×3). Split the test work into a test-owned task ` +
        `([executor: TEST]) and keep this unit product-only.`,
    );
  }
  return errors;
}

/** Hard variant used by the graph builder: throws on any admission error. */
export function assertImplementationAdmission(graph) {
  const errors = implementationAdmissionErrors(graph);
  if (errors.length > 0) {
    throw new Error(
      `OWNERSHIP_ADMISSION_FAILED: ${errors.length} implementation-dispatched unit(s) carry test-owned writes:\n` +
        errors.map((e) => `  - ${e}`).join('\n'),
    );
  }
}

/**
 * Repo-local git identity commands pinning the LANE identity at worktree
 * creation — lane commits must never inherit the ambient user config
 * (live b659eef0: lane commits authored as the host user).
 */
export function laneGitIdentityCommands(lane) {
  const name = `Foresift Wave Lane ${lane}`;
  return [`git config user.name "${name}"`, 'git config user.email "noreply@foresift.local"'];
}
