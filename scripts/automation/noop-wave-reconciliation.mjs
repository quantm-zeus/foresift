// Coordinator reconciliation for proven no-op waves (run 4e59191b, 2026-09-10).
//
// When every dispatched writer lane reports zero completed units BECAUSE every
// dispatched unit is evidence-proven already-satisfied/no-op — closed in the
// canonical tasks.md with [evidence: NO_OP_ALREADY_SATISFIED] anywhere in its
// task block — and no lane carries a UNIQUE writer diff, the wave owns
// coordinator-reconciled progress: integrate-and-fast may proceed to the FAST
// verdict (which re-verifies the whole tree, never vacuously) instead of
// failing integration_empty (exit 90).
//
// Genuinely unfinished or unproven zero-work stays fail-closed: any unit that
// is still OPEN, closed under other evidence, or whose block carries an
// unknown marker fails its lane; any lane with a unique diff (a byte that is
// not already byte-identical at the canonical HEAD), a missing result
// manifest, or an unverifiable branch fails its lane. One failed lane fails
// the wave — the exit-90 fatal below is preserved exactly.
//
// Usage:
//   node scripts/automation/noop-wave-reconciliation.mjs --package <id> \
//     --graph <task-graph.json> --results-dir <dir> \
//     [--canonical <checkout-path>] [--root <repo>] [--out <report.json>]
//
// Exit 0 + { reconciled: true } when the law holds; exit 1 + reasons when it
// does not. Zero AI: git truth + task-block parsing only.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, writeFileSync, lstatSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { repoRoot } from './schema.mjs';
import { resolveBlockEvidence } from './task-metadata.mjs';

export const NOOP_EVIDENCE = 'NO_OP_ALREADY_SATISFIED';

function fail(msg) {
  console.error(`noop-wave-reconciliation: ${msg}`);
  process.exit(1);
}

/**
 * Read one unit's full task block (checkbox line + wrapped continuations
 * until the next checkbox or heading) from canonical tasks.md text.
 * Returns { found, done, blockText }.
 */
export function readTaskBlock(tasksText, taskId) {
  const lines = String(tasksText ?? '').split('\n');
  let start = -1;
  let done = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- \[([ x])\] (.*)$/);
    if (!m) continue;
    const idTok = m[2].split(/\s+/).find((t) => /^T\d+$/.test(t));
    if (idTok === taskId) {
      start = i;
      done = m[1] === 'x';
      break;
    }
  }
  if (start < 0) return { found: false, done: false, blockText: '' };
  const block = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^- \[[ x]\] /.test(lines[i]) || /^#{1,6}\s/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return { found: true, done, blockText: block.join('\n') };
}

/**
 * Deterministic no-op-wave audit. Inputs are plain data (no process exit):
 * @param opts { packageId, graph, resultsDir, canonical }
 * @returns { ok, report } — ok true only when EVERY dispatched lane proves
 *          closed-no-op units and zero unique diff.
 */
export function reconcileNoopWave(opts) {
  const { packageId, graph, resultsDir, canonical } = opts;
  const report = {
    schema: 'foresift/noop-wave-reconciliation@1',
    package: packageId,
    dispatched: 0,
    reconciledLanes: [],
    failedLanes: [],
    reconciled: false,
  };
  const git = (cmd) => {
    const r = spawnSync(`git ${cmd}`, { shell: true, cwd: canonical, encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  };
  const allLanes = [...(graph.shards ?? []), ...(graph.testLanes ?? [])];
  const shardById = new Map(allLanes.map((s) => [s.id, s]));

  if (!existsSync(resultsDir) || !lstatSync(resultsDir).isDirectory())
    return {
      ok: false,
      report,
      reason: `results dir missing or not a directory: ${resultsDir}`,
    };
  const resultFiles = [];
  for (const e of readdirSync(resultsDir, { withFileTypes: true })) {
    if (e.isDirectory() && existsSync(join(resultsDir, e.name, 'result.json')))
      resultFiles.push(join(resultsDir, e.name, 'result.json'));
    else if (e.isFile() && e.name.endsWith('.json')) resultFiles.push(join(resultsDir, e.name));
  }
  resultFiles.sort();
  if (resultFiles.length === 0)
    return { ok: false, report, reason: 'no dispatched lane results — not a no-op wave' };
  report.dispatched = resultFiles.length;

  const tasksPath = join(canonical, 'specs', packageId, 'tasks.md');
  if (!existsSync(tasksPath))
    return { ok: false, report, reason: `canonical tasks.md missing: ${tasksPath}` };
  const tasksText = readFileSync(tasksPath, 'utf8');

  for (const filePath of resultFiles) {
    let res;
    try {
      res = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (e) {
      report.failedLanes.push({
        file: filePath,
        reason: `unreadable result json: ${e.message}`,
      });
      continue;
    }
    const laneName = filePath.endsWith('result.json')
      ? basename(dirname(filePath))
      : basename(filePath).replace(/\.json$/, '');
    const sid = res.shardId ?? laneName;
    const shard = shardById.get(sid);
    if (!shard) {
      report.failedLanes.push({ shardId: sid, reason: 'no such shard in task graph' });
      continue;
    }
    // Only zero-completion lanes are eligible: a lane that nominated units
    // took the normal integration path (accepted or rejected above us).
    const claimed = Array.isArray(res.completed) ? res.completed : [];
    if (claimed.length > 0) {
      report.failedLanes.push({
        shardId: sid,
        reason: `lane nominated ${claimed.length} unit(s) — normal integration owns it, not no-op reconciliation`,
      });
      continue;
    }
    // Every dispatched unit must be closed-no-op in canonical tasks.md.
    const checkSet = [...new Set([...(shard.units ?? []), ...claimed])].sort();
    const unitReasons = [];
    for (const tid of checkSet) {
      const block = readTaskBlock(tasksText, tid);
      if (!block.found) {
        unitReasons.push(`${tid}: absent from canonical tasks.md`);
        continue;
      }
      if (!block.done) {
        unitReasons.push(`${tid}: still OPEN in canonical tasks.md`);
        continue;
      }
      let evidence;
      try {
        evidence = resolveBlockEvidence(block.blockText, { unitId: tid });
      } catch (e) {
        unitReasons.push(
          `${tid}: block evidence unresolvable (${String(e.message).split(':')[0]})`,
        );
        continue;
      }
      if (evidence !== NOOP_EVIDENCE)
        unitReasons.push(`${tid}: closed under ${evidence}, not ${NOOP_EVIDENCE}`);
    }
    if (unitReasons.length > 0) {
      report.failedLanes.push({ shardId: sid, reason: unitReasons.join('; ') });
      continue;
    }
    // No UNIQUE writer diff: every file the lane touched between its base
    // and head must already be byte-identical at the canonical HEAD (or the
    // lane diff must be empty). A missing manifest, an unverifiable branch,
    // or any byte difference fails the lane — fail-closed.
    if (!res.branch || !res.headSha || !res.baseSha) {
      report.failedLanes.push({
        shardId: sid,
        reason: 'result missing branch/headSha/baseSha — unique diff unverifiable',
      });
      continue;
    }
    const verifyHead = git(`rev-parse --verify ${res.headSha}`);
    if (!verifyHead.ok) {
      report.failedLanes.push({
        shardId: sid,
        reason: `lane head ${res.headSha} not verifiable in canonical checkout`,
      });
      continue;
    }
    const diff = git(`diff --name-only ${res.baseSha} ${res.headSha} --`);
    if (!diff.ok && /unknown revision|bad revision/i.test(diff.err)) {
      report.failedLanes.push({
        shardId: sid,
        reason: `lane base ${res.baseSha} not verifiable in canonical checkout`,
      });
      continue;
    }
    const files = diff.ok
      ? diff.out
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const uniqueDiffs = [];
    for (const f of files) {
      const laneBlob = git(`rev-parse ${res.headSha}:'${f}'`);
      const canonBlob = git(`rev-parse HEAD:'${f}'`);
      // A file missing on EITHER side is a unique diff (added/removed work
      // the canonical tree does not already carry byte-identically).
      if (!laneBlob.ok || !canonBlob.ok || laneBlob.out !== canonBlob.out) uniqueDiffs.push(f);
    }
    if (uniqueDiffs.length > 0) {
      report.failedLanes.push({
        shardId: sid,
        reason: `lane carries unique writer diff: ${uniqueDiffs.join(', ')}`,
      });
      continue;
    }
    report.reconciledLanes.push({
      shardId: sid,
      units: checkSet,
      diffFiles: files.length,
      uniqueDiffs: 0,
    });
  }

  if (report.failedLanes.length > 0 || report.reconciledLanes.length === 0)
    return {
      ok: false,
      report,
      reason:
        report.failedLanes.length > 0
          ? `${report.failedLanes.length} lane(s) unproven — wave stays fail-closed`
          : 'no lane reconciled',
    };
  report.reconciled = true;
  return { ok: true, report };
}

function cli() {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const packageId = value('--package');
  const graphPath = value('--graph');
  const resultsDir = value('--results-dir');
  if (!packageId) fail('missing --package <id>');
  if (!graphPath) fail('missing --graph <task-graph.json>');
  if (!resultsDir) fail('missing --results-dir <dir>');
  const root = value('--root') ?? repoRoot();
  const canonical = value('--canonical') ?? root;
  let graph;
  try {
    graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  } catch (e) {
    fail(`unreadable graph json: ${e.message}`);
  }
  const { ok, report, reason } = reconcileNoopWave({
    packageId,
    graph,
    resultsDir,
    canonical,
  });
  const outJson = JSON.stringify(report, null, 2) + '\n';
  const out = value('--out');
  if (out) writeFileSync(out, outJson);
  else process.stdout.write(outJson);
  if (!ok) fail(reason ?? 'wave not no-op reconcilable');
  console.error(
    `noop-wave-reconciliation: reconciled ${report.reconciledLanes.length}/${report.dispatched} dispatched lane(s)`,
  );
}

if (process.argv[1]?.endsWith('noop-wave-reconciliation.mjs')) cli();
