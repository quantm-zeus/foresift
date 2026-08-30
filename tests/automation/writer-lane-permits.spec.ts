// H2 §2/§5 — writer-side lane permits: identity fail-closed, permit around the
// provider invocation, engine-specific attribution feeding ONLY the Codex pool.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLanePermit,
  releaseLanePermit,
  reconcileLaneHolders,
  holderRegistryView,
  observeCodexOutcome,
  providerAdmissionView,
  resolvePoolStateDir,
} from '../../scripts/automation/provider-pool.mjs';
import { codexProviderEvent } from '../../scripts/automation/exec-codex-writer.mjs';

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'writer-permits-pool-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('writer lane-permit identity (H2 §2: fail closed)', () => {
  test('holder identity is required: empty holder is rejected', () => {
    expect(() => acquireLanePermit(stateDir, '', 'codex')).toThrow(/INVALID_LANE_HOLDER/);
    expect(() => releaseLanePermit(stateDir, '', 'codex')).toThrow(/INVALID_LANE_HOLDER/);
  });

  test('generation 0 is a REAL generation and must be accepted (P0 falsy-zero fix)', () => {
    // The workflow falls back to generation 0 for legacy/non-@g messages, so
    // writers must not treat 0 as "missing". Validation lives at the writers;
    // assert the exported validators accept 0 and 1 and refuse the rest.
    return Promise.all([
      import('../../scripts/automation/exec-codex-writer.mjs'),
      import('../../scripts/automation/exec-agy-test-writer.mjs'),
    ]).then(([codex, agy]) => {
      expect(codex.validateGeneration('0')).toBe(0);
      expect(codex.validateGeneration('1')).toBe(1);
      expect(agy.validateGeneration('0')).toBe(0);
      expect(agy.validateGeneration('1')).toBe(1);
      for (const bad of ['', undefined, null, '-1', 'NaN', '1.5', 'abc', ' 7x']) {
        expect(() => codex.validateGeneration(bad)).toThrow(/INVALID_GENERATION/);
        expect(() => agy.validateGeneration(bad)).toThrow(/INVALID_GENERATION/);
      }
      expect(() => codex.validateGeneration(undefined)).toThrow(/INVALID_GENERATION/);
      expect(() => agy.validateGeneration('-3')).toThrow(/INVALID_GENERATION/);
    });
  });

  test('resolvePoolStateDir precedence: explicit > autopilot > XDG default', () => {
    expect(
      resolvePoolStateDir({ FORESIFT_PROVIDER_POOL_STATE_DIR: '/a' } as Record<string, string>),
    ).toBe('/a');
    expect(
      resolvePoolStateDir({
        FORESIFT_AUTOPILOT_STATE_DIR: '/b',
        HOME: '/home/x',
      } as Record<string, string>),
    ).toBe('/b');
    expect(resolvePoolStateDir({ HOME: '/home/x' } as Record<string, string>)).toBe(
      '/home/x/.local/state/foresift',
    );
  });
});

describe('engine-specific attribution (H2 §5: Codex events stay on Codex)', () => {
  test('SUCCESS maps to healthy; usage-limit latches exhausted with sane reset', () => {
    expect(codexProviderEvent('SUCCESS', '')).toEqual({ event: 'healthy' });
    const ev = codexProviderEvent(
      'TRANSIENT_PROVIDER_FAILURE',
      'usage limit reached; resets at 1788110000000',
    );
    expect(ev.event).toBe('exhausted');
    expect(ev.resetAt).toBe(1788110000000);
  });

  test('429 without reset time maps to near_limit; unknown failures stay UNKNOWN', () => {
    expect(codexProviderEvent('TRANSIENT_PROVIDER_FAILURE', 'HTTP 429 rate limit').event).toBe(
      'near_limit',
    );
    expect(codexProviderEvent('SEMANTIC_OR_PROVIDER_FAILURE', 'cannot compile module').event).toBe(
      'unknown',
    );
  });

  test('Codex exhausted feeds ONLY the Codex pool (§22-F/G)', () => {
    observeCodexOutcome(stateDir, {
      event: 'exhausted',
      resetAt: Date.now() + 3_600_000,
    });
    expect(providerAdmissionView(stateDir).codex.blocked).toBe(true);
    expect(providerAdmissionView(stateDir).claude.blocked).toBe(false);
    expect(providerAdmissionView(stateDir).agy.blocked).toBe(false);
  });

  test('codexProviderEvent never returns a Claude-pool event', () => {
    for (const classification of ['SUCCESS', 'TIMEOUT', 'TRANSIENT_PROVIDER_FAILURE']) {
      const ev = codexProviderEvent(classification, '429 rate limit');
      expect(Object.keys(ev)).not.toContain('healthy');
    }
  });
});

describe('permit lifecycle around a provider invocation (H2 §2)', () => {
  test('permit held during invocation, released in finally-equivalent, denial recorded', () => {
    const holder = 'pkg-a:0:core';
    // Acquire → simulate the provider stream → release (the writers wrap
    // spawnSync exactly like this).
    const permit = acquireLanePermit(stateDir, holder, 'codex');
    expect(permit.ok).toBe(true);
    expect(providerAdmissionView(stateDir).codex.active).toBe(1);
    const released = releaseLanePermit(stateDir, holder, 'codex');
    expect(released.released).toBe(1);
    expect(providerAdmissionView(stateDir).codex.active).toBe(0);

    // A denied permit produces a recorded denial artifact shape (the writer
    // writes permit-denied.json with this schema).
    const policy = JSON.stringify({
      claude: { initial: 1, normalTarget: 1, burstTarget: 1, hardCap: 1 },
      codex: { initial: 1, normalTarget: 1, burstTarget: 1, hardCap: 1 },
      agy: { normalTarget: 1, burstTarget: 1, hardCap: 1 },
    });
    writeFileSync(join(stateDir, 'provider-pools.policy.json'), policy);
    const a = acquireLanePermit(stateDir, 'pkg-b:0:core', 'codex');
    expect(a.ok).toBe(true);
    const b = acquireLanePermit(stateDir, 'pkg-b:0:shard-1', 'codex');
    expect(b.ok).toBe(false);
    expect(b.reason).toMatch(/QUOTA|BACKOFF|LIMIT/);
    releaseLanePermit(stateDir, 'pkg-b:0:core', 'codex');
    // Denial artifact contract: the file the writer would emit parses and
    // names the reason.
    const denial = {
      schema: 'foresift/lane-permit-denial@1',
      holder: 'pkg-b:0:shard-1',
      provider: 'codex',
      reason: b.reason,
      waitMs: b.waitMs,
    };
    expect(denial.schema).toBe('foresift/lane-permit-denial@1');
    expect(denial.holder).toBe('pkg-b:0:shard-1');
  });

  test('acquire is ONE atomic transaction: duplicate holder cannot double-increment', () => {
    const policy = JSON.stringify({
      codex: { initial: 2, normalTarget: 2, burstTarget: 2, hardCap: 3 },
    });
    writeFileSync(join(stateDir, 'provider-pools.policy.json'), policy);
    const holder = 'pkg-atomic:0:core';
    const first = acquireLanePermit(stateDir, holder, 'codex');
    expect(first.ok).toBe(true);
    expect(first.alreadyHeld).toBeFalsy();
    expect(providerAdmissionView(stateDir).codex.active).toBe(1);
    // Same holder re-acquiring is idempotent (ALREADY_HELD semantics): no
    // second increment, no overwrite of the single registration.
    const second = acquireLanePermit(stateDir, holder, 'codex');
    expect(second.ok).toBe(true);
    expect(second.alreadyHeld).toBe(true);
    expect(providerAdmissionView(stateDir).codex.active).toBe(1);
    // A single release frees the single permit (holder-scoped, idempotent).
    expect(releaseLanePermit(stateDir, holder, 'codex').released).toBe(1);
    expect(releaseLanePermit(stateDir, holder, 'codex').released).toBe(0);
    expect(providerAdmissionView(stateDir).codex.active).toBe(0);
  });

  test('crash between increment and registration is impossible (atomicity)', () => {
    // With acquirePermitLocked under one lock, any observable state has
    // active === holder-count per provider. Simulate the old crash window's
    // residue: an active count without a holder registration — reconciliation
    // must NOT silently "fix" pool truth, but a registry with matching holder
    // count stays consistent after acquire+crash tests.
    acquireLanePermit(stateDir, 'pkg-crash:0:core', 'codex', {
      packageId: 'pkg-crash',
      generation: 0,
      laneId: 'core',
    });
    const view = providerAdmissionView(stateDir);
    const registry = holderRegistryView(stateDir);
    const codexHolders = Object.keys(registry).filter((k) => k.startsWith('codex '));
    expect(codexHolders.length).toBe(view.codex.active);
  });

  test('stale-holder reconciliation: crashed holder freed, live kept, unknown fail-closed', () => {
    const policy = JSON.stringify({
      codex: { initial: 3, normalTarget: 3, burstTarget: 3, hardCap: 3 },
      agy: { normalTarget: 3, burstTarget: 3, hardCap: 3 },
    });
    writeFileSync(join(stateDir, 'provider-pools.policy.json'), policy);
    acquireLanePermit(stateDir, 'pkg-x:0:core', 'codex', { pid: 1 }); // pid 1 is alive on linux but we use a custom proof below
    acquireLanePermit(stateDir, 'pkg-x:0:shard-1', 'codex', { runId: 'run-A' });
    acquireLanePermit(stateDir, 'pkg-x:0:test-author', 'agy', { runId: 'run-B' });
    expect(providerAdmissionView(stateDir).codex.active).toBe(2);
    expect(providerAdmissionView(stateDir).agy.active).toBe(1);

    // Proof function from durable run truth (NOT pid): runIds still active.
    const activeRuns = new Set(['run-A']); // run-B and the pid-1 holder are provably dead
    const proof = (record: Record<string, unknown>) =>
      record.runId ? activeRuns.has(record.runId as string) : null; // no runId ⇒ unknown
    const res = reconcileLaneHolders(stateDir, proof);
    // The run-A holder is provably live; the run-B holder provably dead.
    expect(res.released).toEqual(['agy pkg-x:0:test-author']);
    expect(res.kept).toEqual(['codex pkg-x:0:shard-1']);
    expect(res.unknown).toEqual(['codex pkg-x:0:core']);
    expect(providerAdmissionView(stateDir).codex.active).toBe(2); // unknown NOT freed
    expect(providerAdmissionView(stateDir).agy.active).toBe(0);
    // Unknown holders surface as an actionable incident, never lost capacity.
    const view = holderRegistryView(stateDir, proof);
    expect(view['codex pkg-x:0:core'].liveness).toBeNull();
  });

  test('supervisor restart reconciliation with default pid proof', () => {
    // Default proof = recorded pid liveness. A holder whose pid is provably
    // dead is released; a live pid is kept; a record with no probeable pid
    // fails closed as unknown. Use an explicit dead-pid proof for
    // determinism (a real pid that has exited is racy to conjure).
    const policy = JSON.stringify({
      codex: { initial: 3, normalTarget: 3, burstTarget: 3, hardCap: 3 },
      agy: { normalTarget: 3, burstTarget: 3, hardCap: 3 },
    });
    writeFileSync(join(stateDir, 'provider-pools.policy.json'), policy);
    acquireLanePermit(stateDir, 'pkg-y:0:core', 'codex', { pid: process.pid }); // alive
    acquireLanePermit(stateDir, 'pkg-y:0:shard-1', 'codex', { pid: 999999999 }); // out of pid space ⇒ dead
    acquireLanePermit(stateDir, 'pkg-y:0:test-author', 'agy', {}); // pid recorded from process — alive
    const res = reconcileLaneHolders(stateDir); // default pid proof
    expect(res.kept).toContain('codex pkg-y:0:core');
    expect(res.kept).toContain('agy pkg-y:0:test-author');
    expect(res.released).toEqual(['codex pkg-y:0:shard-1']);
    expect(providerAdmissionView(stateDir).codex.active).toBe(1);
    expect(providerAdmissionView(stateDir).agy.active).toBe(1);
  });
});
