// Wave phase-split timing telemetry (directive 2026-09-06 §6).
//
// Live evidence: core-batch-1 (run fbbcb1d7) burned 64m35s of writer wall
// clock on already-satisfied units and no artifact answered "where did the
// wall clock go" — provider time, reconciliation, control-plane prep, and
// waits were scattered across separate files. This generator joins the run's
// artifacts into ONE machine-readable phase table:
//
//   prep            base-head.txt → task-graph.json (control-plane prep)
//   reconciliation  task-graph → pre-provider-reconciliation.json (§4 pass)
//   parallelism_aud task-graph → parallelism-audit.json (§5 audit)
//   lanes           per-lane foresift/lane-telemetry@1 (provider-sunk time)
//   fast            wave-fast-verdict.json presence + mtime
//
// Zero AI, pure file arithmetic (mtime deltas + telemetry JSON). Absent
// optional artifacts are recorded as present:false with a null duration —
// never fabricated, never a thrown error. The wave tail mirrors the report
// for the supervisor's telemetry.
//
// Usage: node scripts/automation/wave-timing-report.mjs --artifacts <dir> \
//          [--out <wave-timing.json>]
import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPORT_SCHEMA = 'foresift/wave-timing@1';

function mtimeMs(root, rel) {
  try {
    return statSync(join(root, rel)).mtimeMs;
  } catch {
    return null;
  }
}

function delta(aMs, bMs) {
  if (aMs === null || bMs === null) return null;
  const s = Math.max(0, Math.round((bMs - aMs) / 1000));
  return s;
}

function phase(id, seconds, present, extra = {}) {
  return { id, seconds, present, ...extra };
}

/**
 * Build the phase table for one wave run's artifacts directory.
 * @param {{ root: string }} ctx — root = the run's artifacts dir
 */
export function waveTimingReport(ctx) {
  const root = ctx.root;
  const baseMs = mtimeMs(root, 'base-head.txt');
  const graphMs = mtimeMs(root, 'task-graph.json');
  const reconMs = mtimeMs(root, 'pre-provider-reconciliation.json');
  const auditMs = mtimeMs(root, 'parallelism-audit.json');
  const verdictMs = mtimeMs(root, 'wave-fast-verdict.json');

  const phases = [
    phase('prep', delta(baseMs, graphMs), baseMs !== null && graphMs !== null),
    phase('reconciliation', delta(graphMs, reconMs), reconMs !== null),
    // Parallelism audit runs AFTER reconciliation in the prep node — measure
    // the delta from the reconciliation report when it exists, else from the
    // graph (a wave with nothing to reconcile writes no recon artifact).
    phase('parallelism_audit', delta(reconMs ?? graphMs, auditMs), auditMs !== null),
  ];

  // Lanes: aggregate every writer-results/<lane>/telemetry.json
  const resultsDir = join(root, 'writer-results');
  const lanes = [];
  let writerWallTimeMs = 0;
  let lanesPresent = false;
  try {
    for (const lane of readdirSync(resultsDir)) {
      const tp = join(resultsDir, lane, 'telemetry.json');
      if (!existsSync(tp)) continue;
      lanesPresent = true;
      try {
        const t = JSON.parse(readFileSync(tp, 'utf8'));
        lanes.push({
          lane: t.lane ?? lane,
          outcome: t.outcome ?? 'UNKNOWN',
          wallTimeMs: typeof t.wallTimeMs === 'number' ? t.wallTimeMs : null,
          engine: t.engine ?? null,
          handedOffFrom: t.handedOffFrom ?? null,
        });
        if (typeof t.wallTimeMs === 'number') writerWallTimeMs += t.wallTimeMs;
      } catch {
        lanes.push({
          lane,
          outcome: 'UNREADABLE',
          wallTimeMs: null,
          engine: null,
          handedOffFrom: null,
        });
      }
    }
  } catch {
    // no writer-results dir at all — lanes phase stays absent
  }
  phases.push(
    phase('lanes', null, lanesPresent, {
      lanes,
      writerWallTimeMs: lanesPresent ? writerWallTimeMs : null,
    }),
  );

  phases.push(
    phase('fast', null, verdictMs !== null, {
      verdict: verdictMs !== null ? readVerdict(root) : null,
    }),
  );

  const accountedSeconds = phases.reduce(
    (acc, p) => acc + (typeof p.seconds === 'number' ? p.seconds : 0),
    0,
  );
  return { schema: REPORT_SCHEMA, phases, accountedSeconds };
}

function readVerdict(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'wave-fast-verdict.json'), 'utf8'));
  } catch {
    return null;
  }
}

const invokedDirectly = process.argv[1]?.endsWith('wave-timing-report.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = value('--artifacts');
  if (!root) {
    console.error('usage: wave-timing-report.mjs --artifacts <dir> [--out <wave-timing.json>]');
    process.exit(2);
  }
  const report = waveTimingReport({ root });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (value('--out')) writeFileSync(value('--out'), json);
  else process.stdout.write(json);
  console.error(
    `wave-timing: accounted=${report.accountedSeconds}s writerWall=${report.phases.find((p) => p.id === 'lanes')?.writerWallTimeMs ?? 'unknown'}ms`,
  );
}
