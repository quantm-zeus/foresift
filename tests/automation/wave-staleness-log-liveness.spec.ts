// Wave-staleness false-kill regression (incidents 2026-09-05, runs d32ff2cb
// and 1c294b3c): archon's runs-row last_activity_at stays LAUNCH-FROZEN during
// detached bash-node execution, and a sharded wave legitimately runs many
// writer lanes back-to-back — serial lanes of 50-90 minutes each plus retries
// — so the supervisor's STALE_RUN_MS check (sized for ONE 2h node) fired at
// exactly 3h after launch and abandoned fully-productive waves mid-flight,
// twice in one day. The second abandon then duplicated the package (the
// stale-abandoned run's DAG executor kept working alongside the fresh launch).
//
// Law under test: a detached run is NOT stale while its detached-run log is
// growing. The DAG executor writes a line for every node start/complete, so
// log freshness is the run's real pulse. The staleness decision must consult
// the log (via the launch ack's logPath, captured on the tracked entry, or a
// discovered log for adopted runs) before declaring a run orphaned — and a
// genuinely dead run (silent log AND frozen bookkeeping) is still abandoned,
// fail-closed.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { detachedRunLogFreshness } = await import('../../scripts/automation/foresift-autopilot.mjs');

let LOGS: string;

beforeEach(() => {
  LOGS = mkdtempSync(join(tmpdir(), 'stale-log-'));
});

afterEach(() => {
  try {
    rmSync(LOGS, { recursive: true, force: true });
  } catch {}
});

function makeLog(name: string, ageMs: number, content = '{"level":30,"msg":"dag_node_started"}') {
  const p = join(LOGS, name);
  writeFileSync(p, `${content}\n`);
  const t = new Date(Date.now() - ageMs);
  utimesSync(p, t, t);
  return p;
}

describe('detachedRunLogFreshness: wave liveness from detached-run log growth', () => {
  test('fresh log within the staleness window proves the run alive (logPath seam)', () => {
    const p = makeLog('detached-run-cli-1000-abcd.log', 40 * 60_000);
    const r = detachedRunLogFreshness({
      logsDir: LOGS,
      logPath: p,
      startedAt: Date.now() - 3 * 60 * 60_000,
      windowMs: 3 * 60 * 60_000,
    });
    expect(r.fresh).toBe(true);
    expect(r.logPath).toBe(p);
  });

  test('stale log (silent past the window) does NOT prove liveness', () => {
    const p = makeLog('detached-run-cli-1000-abcd.log', 4 * 60 * 60_000);
    const r = detachedRunLogFreshness({
      logsDir: LOGS,
      logPath: p,
      startedAt: Date.now() - 5 * 60 * 60_000,
      windowMs: 3 * 60 * 60_000,
    });
    expect(r.fresh).toBe(false);
  });

  test('absent logPath: discovers any detached-run log modified within the window', () => {
    makeLog('detached-run-cli-2000-efgh.log', 10 * 60_000);
    const r = detachedRunLogFreshness({
      logsDir: LOGS,
      logPath: null,
      startedAt: Date.now() - 3 * 60 * 60_000,
      windowMs: 3 * 60 * 60_000,
    });
    expect(r.fresh).toBe(true);
    expect(r.logPath).toContain('detached-run-cli-2000-efgh.log');
  });

  test('discovery is scoped to logs born at/after run start (no cross-run contamination)', () => {
    // Old log from a PREVIOUS run, freshly touched by an unrelated writer —
    // birthtime (not mtime) scopes discovery, exercised through the stat seam.
    makeLog('detached-run-cli-0000-old.log', 10 * 60_000);
    const bornEarly = new Date(Date.now() - 30 * 60_000);
    const r = detachedRunLogFreshness({
      logsDir: LOGS,
      logPath: null,
      startedAt: bornEarly.getTime(),
      windowMs: 3 * 60 * 60_000,
      logBornAfter: Date.now() - 5 * 60_000,
      statOverride: () => ({
        mtimeMs: Date.now() - 10 * 60_000,
        birthtimeMs: bornEarly.getTime(),
      }),
    });
    expect(r.fresh).toBe(false);
  });

  test('empty/missing logs dir: no opinion toward liveness (fail-closed)', () => {
    const missing = join(LOGS, 'does-not-exist');
    const r = detachedRunLogFreshness({
      logsDir: missing,
      logPath: null,
      startedAt: Date.now() - 3 * 60 * 60_000,
      windowMs: 3 * 60 * 60_000,
    });
    expect(r.fresh).toBe(false);
    expect(r.error).toBeUndefined();
  });

  test('unreadable stat is an error, not a liveness signal', () => {
    const p = makeLog('detached-run-cli-3000-ijkl.log', 0);
    const r = detachedRunLogFreshness({
      logsDir: LOGS,
      logPath: p,
      startedAt: Date.now(),
      windowMs: 3 * 60 * 60_000,
      statOverride: () => {
        throw new Error('EACCES');
      },
    });
    expect(r.fresh).toBe(false);
    expect(r.error).toContain('EACCES');
  });
});

describe('staleness wiring: log liveness consulted before any stale-run abandon', () => {
  const SRC = readFileSync(
    join(import.meta.dirname, '../../scripts/automation/foresift-autopilot.mjs'),
    'utf8',
  );

  test('the staleness branch calls detachedRunLogFreshness before abandoning', () => {
    const branch = SRC.slice(SRC.indexOf('Stale BOOKKEEPING is not stale WORK'));
    expect(branch).toContain('detachedRunLogFreshness(');
    expect(branch).toContain('entry.logPath ?? null');
    // the abandon call sits AFTER the log check (only the fail-closed path abandons)
    expect(branch.indexOf('detachedRunLogFreshness(')).toBeGreaterThan(-1);
    expect(branch.indexOf('workflow abandon')).toBeGreaterThan(
      branch.indexOf('detachedRunLogFreshness('),
    );
    // liveness-survivor leaves an auditable event, never silently waits
    expect(branch).toContain('stale_run_bookkeeping_but_log_active');
  });

  test('both package launch sites capture ack.logPath on the tracked entry', () => {
    expect(SRC.match(/logPath: ack\?\.logPath \?\? null/g)?.length).toBe(2);
  });
});
