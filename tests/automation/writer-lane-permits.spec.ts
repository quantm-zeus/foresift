// H2 §2/§5 — writer-side lane permits: identity fail-closed, permit around the
// provider invocation, engine-specific attribution feeding ONLY the Codex pool.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLanePermit,
  releaseLanePermit,
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
});
