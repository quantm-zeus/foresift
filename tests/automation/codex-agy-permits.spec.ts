// Hyperdrive H3 P0-2 — CODEX_AGY permit semantics after the run-level
// reservation removal. Invariant: ONE ACTUAL PROVIDER INVOCATION = ONE
// PROVIDER PERMIT. A CODEX_AGY launch holds NO package-level Codex permit;
// its sharded Codex lanes acquire lane permits at dispatch like every other
// engine. Hermetic proofs:
//   - codex initial limit = 1 ⇒ the FIRST Codex lane of a CODEX_AGY run can
//     actually acquire the single permit (under the old double-count the
//     run-level reservation consumed it and the lane was denied POOL_AT_LIMIT);
//   - codex limit = 3 ⇒ three lanes acquire concurrently, a fourth is denied.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  admitPackageLaunch,
  releasePackageRuntime,
} from '../../scripts/automation/runtime-admission.mjs';
import {
  acquireLanePermit,
  releaseLanePermit,
  providerAdmissionView,
} from '../../scripts/automation/provider-pool.mjs';

let stateDir: string;
const PKG = { id: 'pkg-ca', writeScopes: ['packages/ca/**'] };

function codexLimit(stateDir2: string, limit: number) {
  writeFileSync(
    join(stateDir2, 'provider-pools.policy.json'),
    JSON.stringify({
      codex: { initial: limit, normalTarget: limit, burstTarget: limit, hardCap: limit },
    }),
  );
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'codex-agy-permits-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('CODEX_AGY: ONE invocation = ONE permit (no package + lane double-count)', () => {
  test('codex limit = 1: launch holds nothing; the FIRST Codex lane acquires the single permit', () => {
    codexLimit(stateDir, 1);
    // Admission (acquire+release probe, nothing held) — proves the launch
    // gate leaves the full codex capacity to the lanes.
    const admission = admitPackageLaunch(stateDir, PKG, 'CODEX_AGY');
    expect(admission.ok).toBe(true);
    expect(admission.providers).toEqual([]);
    expect(providerAdmissionView(stateDir).codex.active).toBe(0);
    // The first lane of the sharded wave acquires THE single codex permit.
    const lane1 = acquireLanePermit(stateDir, 'pkg-ca:0:core', 'codex', {
      packageId: 'pkg-ca',
      generation: 0,
      laneId: 'core',
    });
    expect(lane1.ok).toBe(true);
    expect(providerAdmissionView(stateDir).codex.active).toBe(1);
    // A second concurrent lane is denied (capacity, not a phantom package hold).
    const lane2 = acquireLanePermit(stateDir, 'pkg-ca:0:shard-1', 'codex', {
      packageId: 'pkg-ca',
      generation: 0,
      laneId: 'shard-1',
    });
    expect(lane2.ok).toBe(false);
    expect(lane2.reason).toBe('POOL_AT_LIMIT');
    // Lane completion frees the permit for the next lane.
    releaseLanePermit(stateDir, 'pkg-ca:0:core', 'codex');
    const lane3 = acquireLanePermit(stateDir, 'pkg-ca:0:shard-1', 'codex', {
      packageId: 'pkg-ca',
      generation: 0,
      laneId: 'shard-1',
    });
    expect(lane3.ok).toBe(true);
    releaseLanePermit(stateDir, 'pkg-ca:0:shard-1', 'codex');
  });

  test('codex limit = 3: three CODEX_AGY lanes hold the pool concurrently; a fourth is denied', () => {
    codexLimit(stateDir, 3);
    expect(admitPackageLaunch(stateDir, PKG, 'CODEX_AGY').ok).toBe(true);
    const lanes = ['core', 'shard-1', 'shard-2'].map((lane) =>
      acquireLanePermit(stateDir, `pkg-ca:0:${lane}`, 'codex', {
        packageId: 'pkg-ca',
        generation: 0,
        laneId: lane,
      }),
    );
    for (const p of lanes) expect(p.ok).toBe(true);
    expect(providerAdmissionView(stateDir).codex.active).toBe(3);
    const fourth = acquireLanePermit(stateDir, 'pkg-ca:0:shard-3', 'codex', {
      packageId: 'pkg-ca',
      generation: 0,
      laneId: 'shard-3',
    });
    expect(fourth.ok).toBe(false);
    expect(fourth.reason).toBe('POOL_AT_LIMIT');
    for (const lane of ['core', 'shard-1', 'shard-2'])
      releaseLanePermit(stateDir, `pkg-ca:0:${lane}`, 'codex');
    expect(providerAdmissionView(stateDir).codex.active).toBe(0);
  });

  test('admission-then-terminal release is a no-op for providers (leases only) — no permit leak, no double release', () => {
    codexLimit(stateDir, 1);
    const admission = admitPackageLaunch(stateDir, PKG, 'CODEX_AGY');
    expect(admission.ok).toBe(true);
    // The lane runs and finishes between admission and terminal release.
    const lane = acquireLanePermit(stateDir, 'pkg-ca:0:core', 'codex');
    expect(lane.ok).toBe(true);
    releaseLanePermit(stateDir, 'pkg-ca:0:core', 'codex');
    // Terminal release touches only leases (providers list is empty) and
    // never decrements a lane's permit.
    const released = releasePackageRuntime(stateDir, {
      providers: admission.providers,
      packageId: 'pkg-ca',
    });
    expect(released.providers).toEqual([]);
    expect(providerAdmissionView(stateDir).codex.active).toBe(0);
    expect(providerAdmissionView(stateDir).codex.limit).toBe(1);
  });
});
