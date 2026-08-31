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
    const mod = await import('../../scripts/automation/foresift-autopilot.mjs');
    const ack = mod.launchDetached(null, 'foresift-sharded-wave', 'b', 'm', null) as {
      ok?: boolean;
    };
    expect(ack?.ok).toBeTruthy();
    // The env must be restored after the call — no leakage into the process.
    expect(process.env.FORESIFT_WRITERS).toBeUndefined();
    // And the stub observed a positive integer lane count (governor GREEN on
    // the host, pools materialize with codex/claude limits ≥ 1).
    const line = readFileSync(join(fxRoot, 'env.log'), 'utf8').trim();
    const writers = /WRITERS=(\d+)/.exec(line)?.[1];
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
