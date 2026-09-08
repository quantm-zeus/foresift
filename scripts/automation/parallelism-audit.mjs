// Parallelism quality gate (directive 2026-09-06 §5, canary).
//
// Live evidence: g1-capacity-contracts (run b659eef0) plans a serial column of
// 13 units (core-batch-3, load 21, laneTooLarge) although the graph's own
// write-truth proves most of them pairwise write-disjoint and dependency-free —
// the plan burned provider wall clock serially on work its own plan proved
// parallelizable, and never says why.
//
// Law: a PRODUCT unit that (a) is not [P], (b) carries no
// [serial-reason: …] exemption, and (c) has ≥1 open sibling unit with EXACT
// disjoint predicted/test writes and no direct dependency edge either way is a
// MISSED_PARALLELISM_OPPORTUNITY. Exemptions are exactly the six-vocabulary
// serial reasons; an unknown value fails closed (SERIAL_REASON_UNKNOWN, exit 3).
// Fail closed on ambiguity: empty write sets, glob writes, and shared paths
// never count as disjointness; non-PRODUCT units are never flagged.
//
// The wave prep node runs this audit after the pre-provider reconciliation and
// BEFORE briefs; the report is mirrored for telemetry. Surfacing is advisory —
// it does NOT dispatch, flip, or modify anything (product tasks are corrected
// in the PLAN, [P] or with a serial-reason marker; the audit never edits).
//
// Usage:
//   node scripts/automation/parallelism-audit.mjs --graph <task-graph.json> \
//     [--report <out.json>]
import { writeFileSync } from 'node:fs';

const REPORT_SCHEMA = 'foresift/parallelism-audit@1';

export const SERIAL_REASONS = Object.freeze([
  'SEMANTIC_DEPENDENCY',
  'SHARED_FILE',
  'ORDERED_MIGRATION',
  'SHARED_INVARIANT',
  'COORDINATOR_BOUNDARY',
  'SAFETY_SERIALIZATION',
]);

const SERIAL_REASON_MARKER = /\[serial-reason:\s*([A-Za-z_-]+)\]/;

/**
 * @param graph task graph (units carry executor, parallelizable, body,
 *              predictedWrites, productWrites, testWrites, dependsOn, done)
 * @returns array of { taskId, disjointWith } — empty when no opportunity missed
 * @throws SERIAL_REASON_UNKNOWN when a serial-reason marker names a value
 *         outside the six-word vocabulary (fail closed, never silently accept)
 */
export function missedParallelismOpportunities(graph) {
  const units = (graph?.units ?? []).filter((u) => !u.done);
  // Parse + validate serial-reason markers FIRST: an unknown value is a hard
  // error even when no disjoint sibling exists (the vocabulary is a law, not
  // an optimization hint).
  for (const u of units) {
    const m = (u.body ?? '').match(SERIAL_REASON_MARKER);
    if (m && !SERIAL_REASONS.includes(m[1])) {
      throw new Error(`SERIAL_REASON_UNKNOWN: ${m[1]} (in ${u.id})`);
    }
  }
  const exact = (u) => [...(u.productWrites ?? []), ...(u.testWrites ?? [])];
  const hasGlob = (ws) => ws.some((p) => p.includes('*'));
  const open = units.filter((u) => (u.executor ?? 'PRODUCT') === 'PRODUCT');
  const missed = [];
  for (const u of open) {
    if (u.parallelizable) continue; // already parallel — nothing missed
    const m = (u.body ?? '').match(SERIAL_REASON_MARKER);
    if (m) continue; // explicit, vocabulary-valid serial reason — exempt
    const writes = exact(u);
    if (writes.length === 0 || hasGlob(writes)) continue; // ambiguous — fail closed
    const disjointWith = [];
    for (const sib of open) {
      if (sib.id === u.id) continue;
      if (u.dependsOn?.includes(sib.id) || sib.dependsOn?.includes(u.id)) continue; // a dependency edge in either direction defeats the pairing
      const sibWrites = exact(sib);
      if (sibWrites.length === 0 || hasGlob(sibWrites)) continue; // ambiguous
      if (writes.some((p) => sibWrites.includes(p))) continue; // shared path
      disjointWith.push(sib.id);
    }
    if (disjointWith.length > 0) missed.push({ taskId: u.id, disjointWith: disjointWith.sort() });
  }
  return missed;
}

const invokedDirectly = process.argv[1]?.endsWith('parallelism-audit.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const graphPath = value('--graph');
  if (!graphPath) {
    console.error('usage: parallelism-audit.mjs --graph <task-graph.json> [--report <out.json>]');
    process.exit(2);
  }
  const { readFileSync } = await import('node:fs');
  let graph;
  try {
    graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  } catch (e) {
    console.error(`parallelism-audit: cannot read graph: ${e.message}`);
    process.exit(2);
  }
  let missed;
  try {
    missed = missedParallelismOpportunities(graph);
  } catch (e) {
    console.error(`parallelism-audit: ${e.message}`);
    process.exit(3); // SERIAL_REASON_UNKNOWN — fail closed
  }
  const report = { schema: REPORT_SCHEMA, missed };
  if (value('--report')) writeFileSync(value('--report'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  console.error(
    `parallelism-audit: ${missed.length} missed parallelism opportunit${missed.length === 1 ? 'y' : 'ies'}`,
  );
  // Advisory: never a wave failure — the report goes to the supervisor
  // telemetry and the PLAN is corrected between waves.
}
