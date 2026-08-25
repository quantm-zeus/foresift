// Hybrid writer-engine selection + headless Antigravity execution for
// sharded-wave PARALLEL lanes (V4 §25/§30).
//
// Engine selection is a PURE, deterministic, fail-closed decision:
//   - default engine is CLAUDE (archon's proven provider adapter — unchanged);
//   - AGY requires BOTH an explicit opt-in (`FORESIFT_AGY_LANES` listing lane
//     ids, e.g. "shard-1,shard-2") AND a runnable `agy` binary on PATH;
//   - anything unexpected (missing env, empty lane id) falls back to CLAUDE.
// The serial core lane NEVER routes to AGY here: the durable core path keeps
// its hard-won archon provider semantics (defect-#10 retry integration).
//
// `exec-agy-writer.mjs` runs one parallel-lane writer through the installed
// Antigravity CLI in headless stream-json mode (the ONLY mode that executes
// real tools — see R6/R7 in .optimizer-evidence/v4-defects-and-runtime-
// findings.md: `--print` answers WITHOUT running tools and hallucinated a
// successful write). It is the bash-node seam for hybrid lanes because
// production Archon v0.9 ships no agy provider adapter (and mission §17
// forbids modifying production Archon). Fail-closed by contract:
//   - the writer brief is rendered verbatim into the prompt;
//   - the run must produce `$ARTIFACTS_DIR/writer-results/<lane>/result.json`
//     with schema foresift/writer-result@1 or the process exits non-zero;
//   - workflow-level retry (max_attempts/delay/on_error: all) supplies L1;
//   - the wave guard re-verifies EVERYTHING afterwards regardless of engine,
//     so an agy lane enjoys exactly the same authority boundaries as a claude
//     lane (private worktree, write-disjoint paths, recomputed diffs).
//
// Envelope-status law (R7): a completed agy turn can report status "ERROR"
// purely because its artifact-path permission declarer rejects writes outside
// its own scratch/brain dirs — even when every operation really executed.
// The envelope status is therefore FORENSIC ONLY; the binding gate is the
// result.json completion contract plus the downstream wave guard.
//
// No credentials are read, moved, or logged here; `agy` uses its own OAuth
// state under ~/.gemini/antigravity-cli. Never commit that state.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Pure engine decision for a lane; the serial core lane NEVER routes to AGY. */
export function decideWriterEngine(
  laneId,
  { env = process.env, hasAgy = agyOnPath(), coreLane } = {},
) {
  if (!laneId || (coreLane ?? laneId === 'core')) return 'CLAUDE';
  const raw = env.FORESIFT_AGY_LANES ?? '';
  const lanes = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lanes.includes(laneId)) return 'CLAUDE';
  return hasAgy ? 'AGY' : 'CLAUDE'; // fail closed: opt-in without binary ⇒ CLAUDE
}

export function agyOnPath() {
  const r = spawnSync('command -v agy', { shell: true, encoding: 'utf8' });
  return r.status === 0 && Boolean((r.stdout ?? '').trim());
}

/**
 * Prep-time engine routing: for each parallel lane write
 * `$ARTIFACTS_DIR/engine-<lane>.txt` whose CONTENT is the when-gate token:
 *   - the exact empty-lane sentinel (identical to the brief emitters') when
 *     the task graph has no such shard — both writer variants stay OFF;
 *   - 'CLAUDE' or 'AGY' otherwise (pure decision above).
 * Returns {lane: content} for logging/tests. Deterministic; no AI dispatch.
 */
export function emitEngineFiles(graphPath, artifactsDir, lanes, opts) {
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const shardIds = new Set((graph.shards ?? []).map((s) => s.id));
  const laneList = lanes ?? ['shard-1', 'shard-2'];
  const out = {};
  for (const lane of laneList) {
    const content = shardIds.has(lane)
      ? decideWriterEngine(lane, opts)
      : `NO ${lane.toUpperCase()} THIS WAVE`;
    writeFileSync(join(artifactsDir, `engine-${lane}.txt`), content);
    out[lane] = content;
  }
  return out;
}

function fail(msg) {
  console.error(`agy-writer: ${msg}`);
  process.exit(1);
}

/** CLI subcommands used by workflow prep before any AI dispatch. */
function cliDecide() {
  const lane = process.argv[3];
  if (!lane) fail('usage: exec-agy-writer.mjs --decide-engine <lane>');
  console.log(JSON.stringify({ lane, engine: decideWriterEngine(lane) }));
}

function cliEmit() {
  const graphPath = process.argv[3];
  const artifactsDir = process.argv[4];
  if (!graphPath || !artifactsDir)
    fail('usage: exec-agy-writer.mjs --emit-engine-files <task-graph.json> <artifacts-dir>');
  console.log(JSON.stringify({ ok: true, engines: emitEngineFiles(graphPath, artifactsDir) }));
}

async function main() {
  const args = {};
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === '--brief') args.brief = process.argv[i + 1];
    if (process.argv[i] === '--worktree') args.worktree = process.argv[i + 1];
    if (process.argv[i] === '--results-dir') args.resultsDir = process.argv[i + 1];
    if (process.argv[i] === '--lane') args.lane = process.argv[i + 1];
    if (process.argv[i] === '--timeout-ms') args.timeoutMs = Number(process.argv[i + 1]);
  }
  if (!args.brief || !args.worktree || !args.resultsDir || !args.lane)
    fail(
      'usage: exec-agy-writer.mjs --lane <id> --brief <file> --worktree <dir> --results-dir <dir> [--timeout-ms ms]',
    );
  if (!existsSync(args.brief)) fail(`brief not found: ${args.brief}`);

  const brief = readFileSync(args.brief, 'utf8');
  // R7 (live probe): agy resolves RELATIVE paths against its own scratch dir,
  // not the process cwd — only ABSOLUTE paths land in the target tree. The
  // prompt therefore pins the worktree and manifest by absolute path.
  const prompt = [
    brief,
    '',
    'Execute this brief now. Your private worktree is the directory:',
    `  ${args.worktree}`,
    'Use ABSOLUTE paths (rooted at that worktree) for EVERY file you create',
    'or edit — relative paths land in a scratch area outside the worktree.',
    'Follow the completion contract EXACTLY: implement every assigned unit,',
    'run the listed targeted tests with absolute paths, commit coherent',
    'slices there as you go, and finish by writing the required result',
    'manifest with your real branch name and HEAD sha.',
    'Do not touch anything outside that worktree.',
    '',
    `RESULT MANIFEST ABSOLUTE PATH (write exactly here): ${args.resultsDir}/result.json`,
  ].join('\n');

  // stream-json turn protocol (R7): one NDJSON input line per turn; requires
  // --output-format stream-json. Tools really execute in this mode.
  const ndjson = `${JSON.stringify({
    event: 'user',
    message: { role: 'user', content: prompt },
  })}\n`;
  const timeoutMs = args.timeoutMs ?? 45 * 60_000;
  const r = spawnSync(
    'agy --input-format stream-json --output-format stream-json --disable-slash-commands --dangerously-skip-permissions',
    {
      shell: true,
      cwd: args.worktree,
      input: ndjson,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  // Full event stream goes to forensics next to the results.
  const outPath = `${args.resultsDir}/agy-run.jsonl`;
  try {
    writeFileSync(outPath, r.stdout ?? '');
  } catch {
    /* forensics only — never fail the lane for log loss */
  }
  if (r.error) fail(`agy spawn failed: ${r.error.message}`);
  if (r.status !== 0) fail(`agy exited ${r.status}: ${(r.stderr ?? '').slice(-400)}`);

  // The LAST `result` event carries the terminal turn state.
  let resultEvent = null;
  for (const line of (r.stdout ?? '').split('\n')) {
    try {
      const e = JSON.parse(line);
      if (e?.event === 'result') resultEvent = e.result ?? null;
    } catch {
      /* non-JSON line — ignore */
    }
  }
  if (!resultEvent) fail('agy produced no stream-json result event');
  // Envelope status is FORENSIC ONLY (R7 false-ERROR quirk); record and move on.

  const resultFile = `${args.resultsDir}/result.json`;
  if (!existsSync(resultFile))
    fail('completion contract violated: writer-results/<lane>/result.json was not written');
  let result;
  try {
    result = JSON.parse(readFileSync(resultFile, 'utf8'));
  } catch (e) {
    fail(`result.json unparseable: ${e.message}`);
  }
  if (result.schema !== 'foresift/writer-result@1')
    fail(`bad result schema: ${String(result.schema)}`);
  console.log(
    JSON.stringify({ ok: true, lane: args.lane, engine: 'AGY', headSha: result.headSha ?? null }),
  );
}

const invokedDirectly = process.argv[1]?.endsWith('exec-agy-writer.mjs');
if (invokedDirectly && process.argv[2] === '--decide-engine') cliDecide();
else if (invokedDirectly && process.argv[2] === '--emit-engine-files') cliEmit();
else if (invokedDirectly) main();
