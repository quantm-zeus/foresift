// Hyperdrive H3 P2-10 — launchDetached adaptive-lane wiring: the sharded wave
// launch sets FORESIFT_WRITERS from resolveAdaptiveLaneCount when the operator
// did not pin one; an explicit env override always wins; the env is restored
// after the launch; non-wave workflows are untouched.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

let fxRoot: string;
let stubDir: string;
let stateDir: string;
let prevPath: string | undefined;

beforeEach(() => {
  fxRoot = mkdtempSync(join(tmpdir(), 'adaptive-launch-fx-'));
  stubDir = join(fxRoot, 'bin');
  stateDir = join(fxRoot, 'state');
  mkdirSync(stubDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  // Stub archon: records the env the workflow run saw; claims the run started.
  const p = join(stubDir, 'archon');
  writeFileSync(
    p,
    [
      '#!/usr/bin/env bash',
      'case "$1 $2" in',
      '  "workflow run") printf \'{"ok":true,"action":"run","conversationId":"stub-conv","logPath":"/tmp/stub.log"}\\n\' ;;',
      '  *) printf \'{"id":"stub","status":"running"}\\n\' ;;',
      'esac',
      'echo "WRITERS=${FORESIFT_WRITERS:-unset} PROFILE=${FORESIFT_EXECUTION_PROFILE:-unset}" >> "$FORESIFT_STUB_ENVLOG"',
    ].join('\n'),
  );
  chmodSync(p, 0o755);
  // Policy file: pools present so providerAdmissionView resolves.
  // Governor state: real /proc/meminfo is GREEN on this host.
  prevPath = process.env.PATH;
  process.env.PATH = `${stubDir}:${prevPath}`;
  process.env.FORESIFT_AUTOPILOT_STATE_DIR = stateDir;
  process.env.FORESIFT_STUB_ENVLOG = join(fxRoot, 'env.log');
});

afterEach(() => {
  rmSync(fxRoot, { recursive: true, force: true });
  if (prevPath === undefined) delete process.env.PATH;
  else process.env.PATH = prevPath;
  delete process.env.FORESIFT_AUTOPILOT_STATE_DIR;
  delete process.env.FORESIFT_STUB_ENVLOG;
  delete process.env.FORESIFT_WRITERS;
  delete process.env.FORESIFT_EXECUTION_PROFILE;
});

describe('launchDetached adaptive lane wiring', () => {
  test('sharded-wave launch sets FORESIFT_WRITERS adaptively and restores the env afterwards', async () => {
    // Hermetic governor (designed seam, same as the governor tests below):
    // a live /proc probe inside a concurrently running group sees the wave's
    // own heavy processes and can transiently throw or reclassify — the
    // assertion must judge the ADAPTIVE WIRING, not the machine's load
    // (observed live: wave 30a52c6a FAST recheck, 2026-09-04).
    process.env.FORESIFT_GOVERNOR_STATE = 'GREEN';
    const mod = await import('../../scripts/automation/foresift-autopilot.mjs');
    const ack = mod.launchDetached(null, 'foresift-sharded-wave', 'b', 'm', null) as {
      ok?: boolean;
    };
    delete process.env.FORESIFT_GOVERNOR_STATE;
    expect(ack?.ok).toBeTruthy();
    // The env must be restored after the call — no leakage into the process.
    expect(process.env.FORESIFT_WRITERS).toBeUndefined();
    // And the stub observed a positive integer lane count (governor GREEN by
    // the hermetic override; pools materialize with codex/claude limits ≥ 1).
    const line = readFileSync(join(fxRoot, 'env.log'), 'utf8').trim();
    const writers = /WRITERS=(\d+)/.exec(line)?.[1];
    expect(writers, `stub env log expected a numeric WRITERS, got: ${line}`).toBeDefined();
    expect(Number(writers)).toBeGreaterThanOrEqual(1);
  });

  test('an explicit FORESIFT_WRITERS override wins and is left untouched', async () => {
    process.env.FORESIFT_WRITERS = '2';
    const mod = await import('../../scripts/automation/foresift-autopilot.mjs');
    mod.launchDetached(null, 'foresift-sharded-wave', 'b', 'm', null);
    expect(process.env.FORESIFT_WRITERS).toBe('2');
    const line = readFileSync(join(fxRoot, 'env.log'), 'utf8').trim();
    expect(line).toContain('WRITERS=2');
  });

  test('non-wave workflows never set FORESIFT_WRITERS', async () => {
    const mod = await import('../../scripts/automation/foresift-autopilot.mjs');
    mod.launchDetached(null, 'foresift-package-planning-bootstrap', 'b', 'm', null);
    expect(process.env.FORESIFT_WRITERS).toBeUndefined();
    const line = readFileSync(join(fxRoot, 'env.log'), 'utf8').trim();
    expect(line).toContain('WRITERS=unset');
  });
});

describe('governor override (FORESIFT_GOVERNOR_STATE)', () => {
  test('forced non-GREEN state is reported by classifyHostState', async () => {
    // Hermetic samples (classifyHostState's designed seam). A live probe
    // inside a FAST wave sees the wave's own bun processes (≥3 heavy ⇒ ORANGE)
    // and would make the post-override GREEN assertion host-load-dependent —
    // the test must classify a KNOWN sample, not the machine it happens to
    // run on (observed live: run 7c98e02e repair recheck).
    const healthy = { total: 16_000_000_000, available: 14_000_000_000, heavyProcesses: 0 };
    process.env.FORESIFT_GOVERNOR_STATE = 'ORANGE';
    const mod = await import('../../scripts/automation/resource-governor.mjs');
    const s = mod.classifyHostState(healthy);
    expect(s.state).toBe('ORANGE');
    expect(s.reason).toContain('FORESIFT_GOVERNOR_STATE=ORANGE');
    delete process.env.FORESIFT_GOVERNOR_STATE;
    expect(mod.classifyHostState(healthy).state).toBe('GREEN');
  });

  test('selection-loop governor gate wiring: non-GREEN refuses new launches', async () => {
    const sample = { total: 16_000_000_000, available: 14_000_000_000, heavyProcesses: 0 };
    process.env.FORESIFT_GOVERNOR_STATE = 'RED';
    const mod = await import('../../scripts/automation/resource-governor.mjs');
    const s = mod.classifyHostState(sample);
    const verdict = mod.admitUnderGovernor(s, { heavy: false });
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toBe('RED: no new launches');
    delete process.env.FORESIFT_GOVERNOR_STATE;
  });
});
