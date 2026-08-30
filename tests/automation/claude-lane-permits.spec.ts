// H2 §10 — headless Claude writer: ONE actual Claude provider invocation =
// ONE Claude lane permit, engine-specific attribution to the Claude pool
// ONLY, and generation-0 acceptance (P0 falsy-zero review finding).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLanePermit,
  providerAdmissionView,
  resolvePoolStateDir,
} from '../../scripts/automation/provider-pool.mjs';
import { claudeProviderEvent } from '../../scripts/automation/exec-claude-writer.mjs';

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'claude-writer-pool-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('engine-specific attribution (H2 §5/§6: Claude events stay on Claude)', () => {
  test('SUCCESS maps to healthy; 429 with Retry-After feeds AIMD pressure', () => {
    expect(claudeProviderEvent('SUCCESS', '')).toEqual({ healthy: true });
    const ev = claudeProviderEvent('TRANSIENT_PROVIDER_FAILURE', 'HTTP 429 retry-after: 45s');
    expect(ev.healthy).toBe(false);
    expect(ev.retryAfterMs).toBe(45_000);
  });

  test('Claude pressure feeds ONLY the Claude pool', async () => {
    const { observeClaudeOutcome } = await import('../../scripts/automation/provider-pool.mjs');
    observeClaudeOutcome(stateDir, { healthy: false, retryAfterMs: 60_000 });
    const view = providerAdmissionView(stateDir);
    expect(view.claude.blocked).toBe(true);
    expect(view.codex.blocked).toBe(false);
    expect(view.agy.blocked).toBe(false);
  });

  test('Claude healthy recovery raises the AIMD limit gradually (2 -> 3)', async () => {
    const { observeClaudeOutcome } = await import('../../scripts/automation/provider-pool.mjs');
    const policy = JSON.stringify({
      claude: { initial: 2, normalTarget: 5, burstTarget: 8, hardCap: 10 },
    });
    writeFileSync(join(stateDir, 'provider-pools.policy.json'), policy);
    for (let i = 0; i < 3; i++) observeClaudeOutcome(stateDir, { healthy: true });
    expect(providerAdmissionView(stateDir).claude.limit).toBe(3);
  });
});

describe('permit identity for Claude lanes (H2 §2/§10)', () => {
  test('wrapper holder identity: package required, generation 0 valid', () => {
    // The wrapper validates identity before acquiring: package required and
    // generation an integer >= 0. Verify the permit plumbing accepts the
    // resulting holder shape for generation 0.
    const permit = acquireLanePermit(stateDir, 'pkg-claude:0:core', 'claude', {
      packageId: 'pkg-claude',
      generation: 0,
      laneId: 'core',
    });
    expect(permit.ok).toBe(true);
    expect(providerAdmissionView(stateDir).claude.active).toBe(1);
  });

  test('resolvePoolStateDir is shared with the Claude wrapper (same durable pools)', () => {
    expect(resolvePoolStateDir({ FORESIFT_PROVIDER_POOL_STATE_DIR: '/c' })).toBe('/c');
  });
});
