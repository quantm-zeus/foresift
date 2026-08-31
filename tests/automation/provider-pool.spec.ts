// Hyperdrive H2 — global provider pool governor regression tests
// (mission §14–§22, §67, §68).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquirePermit,
  releasePermit,
  observeClaudeOutcome,
  observeCodexOutcome,
  providerAdmissionView,
  CODEX_QUOTA_STATES,
  CODEX_EXHAUSTED_LATCH_TTL_MS,
} from '../../scripts/automation/provider-pool.mjs';

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'provider-pools-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('Claude AIMD governor (§15/§16/§67)', () => {
  test('healthy×3 → +1 additive increase (3→4), pressure → halve + backoff', () => {
    let r = observeClaudeOutcome(stateDir, { healthy: true });
    r = observeClaudeOutcome(stateDir, { healthy: true });
    r = observeClaudeOutcome(stateDir, { healthy: true });
    expect(r.limit).toBe(4); // additive increase after sustained health
    r = observeClaudeOutcome(stateDir, { healthy: false });
    expect(r.limit).toBe(2); // multiplicative decrease: ceil(4/2)
    expect(r.backoffUntil).toBeGreaterThan(0);
    // healthy clears backoff
    r = observeClaudeOutcome(stateDir, { healthy: true });
    expect(r.backoffUntil).toBe(0);
  });

  test('§67 sequence: increase → fast decrease → backoff → gradual recovery', () => {
    const events = [true, true, false, true, true];
    const limits = [];
    for (const healthy of events) {
      limits.push(observeClaudeOutcome(stateDir, { healthy }).limit);
    }
    // [3,3, halved→2, 2, 2] — decrease is immediate, recovery is gradual
    expect(limits).toEqual([3, 3, 2, 2, 2]);
    // two more healthy ticks → +1 again
    observeClaudeOutcome(stateDir, { healthy: true });
    const r = observeClaudeOutcome(stateDir, { healthy: true });
    expect(r.limit).toBe(3);
  });

  test('Retry-After honored when sane; hard floor of 1 permit', () => {
    const ra = observeClaudeOutcome(stateDir, {
      healthy: false,
      retryAfterMs: 120_000,
      now: 1_000_000,
    });
    expect(ra.backoffUntil).toBe(1_000_000 + 120_000);
    // hammer pressure down to the floor
    let r: { limit: number; active: number; backoffUntil: number } | undefined;
    for (let i = 0; i < 4; i++) r = observeClaudeOutcome(stateDir, { healthy: false });
    expect(r!.limit).toBe(1);
  });

  test('never exceeds burstTarget on sustained health', () => {
    let r: { limit: number; active: number; backoffUntil: number } | undefined;
    for (let i = 0; i < 30; i++) r = observeClaudeOutcome(stateDir, { healthy: true });
    expect(r!.limit).toBeLessThanOrEqual(8);
  });
});

describe('Permit acquisition (§17: global, not per-package)', () => {
  test('limit blocks; release unblocks; pool state persists to disk', () => {
    for (let i = 0; i < 3; i++) {
      const p = acquirePermit(stateDir, 'claude');
      expect(p.ok).toBe(true);
    }
    const blocked = acquirePermit(stateDir, 'claude');
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('POOL_AT_LIMIT');
    releasePermit(stateDir, 'claude');
    expect(acquirePermit(stateDir, 'claude').ok).toBe(true);
    expect(existsSync(join(stateDir, 'provider-pools.json'))).toBe(true);
  });

  test('backoff blocks new permits until it elapses', () => {
    observeClaudeOutcome(stateDir, { healthy: false, retryAfterMs: 120_000, now: 1_000_000 });
    const during = acquirePermit(stateDir, 'claude', { now: 1_000_001 });
    expect(during.ok).toBe(false);
    expect(during.reason).toBe('PROVIDER_BACKOFF');
    const after = acquirePermit(stateDir, 'claude', { now: 1_000_000 + 121_000 });
    expect(after.ok).toBe(true);
  });
});

describe('Codex quota state machine (§19/§20/§68)', () => {
  test('all six states declared', () => {
    expect(CODEX_QUOTA_STATES).toEqual([
      'HEALTHY',
      'CONSERVE',
      'NEAR_LIMIT',
      'EXHAUSTED',
      'RESET_WAIT',
      'UNKNOWN',
    ]);
  });

  test('EXHAUSTED ⇒ zero new Codex permits with a reset wait, never a package failure', () => {
    // Fixed clock, self-consistent: the observation and the acquire must see
    // the SAME now, or a wall-clock observation of a fixed future resetAt
    // latches EXHAUSTED (correct at observe time) while the acquire's rewound
    // clock re-reads the stored resetAt as still-future (nondeterminism).
    const now = 1_000_000;
    const resetAt = 2_000_000;
    observeCodexOutcome(stateDir, { event: 'exhausted', resetAt, now });
    const p = acquirePermit(stateDir, 'codex', { now: 1_500_000 });
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('CODEX_QUOTA_RESET_WAIT');
    expect(p.waitMs).toBe(500_000);
  });

  test('§68: Claude healthy + Codex exhausted ⇒ Claude lane runs (global pools independent)', () => {
    observeCodexOutcome(stateDir, { event: 'exhausted', resetAt: Date.now() + 3_600_000 });
    const codexP = acquirePermit(stateDir, 'codex');
    const claudeP = acquirePermit(stateDir, 'claude');
    expect(codexP.ok).toBe(false);
    expect(claudeP.ok).toBe(true); // compatible queued lane reroutes to Claude
    releasePermit(stateDir, 'claude');
  });

  test('gradual Codex return: RESET_WAIT → healthy → HEALTHY with permit re-issued', () => {
    observeCodexOutcome(stateDir, { event: 'exhausted', resetAt: Date.now() + 1000 });
    expect(acquirePermit(stateDir, 'codex').ok).toBe(false);
    observeCodexOutcome(stateDir, { event: 'reset_elapsed' });
    expect(acquirePermit(stateDir, 'codex').ok).toBe(true);
  });

  test('unknown failure maps HEALTHY→UNKNOWN and never fabricates exhaustion', () => {
    observeCodexOutcome(stateDir, { event: 'unknown' });
    expect(providerAdmissionView(stateDir).codex.state).toBe('UNKNOWN');
    expect(acquirePermit(stateDir, 'codex').ok).toBe(true);
  });

  test('RESET_WAIT self-heals to HEALTHY once the reset time passes (review finding 3)', () => {
    // No external reset_elapsed emission is required: the next acquire after
    // the stored resetAt recovers the pool inside the same critical section.
    const now = 1_000_000;
    const resetAt = now + 60_000;
    observeCodexOutcome(stateDir, { event: 'exhausted', resetAt, now });
    expect(acquirePermit(stateDir, 'codex', { now: now + 30_000 }).ok).toBe(false);
    const p = acquirePermit(stateDir, 'codex', { now: resetAt + 1 });
    expect(p.ok).toBe(true);
    expect(providerAdmissionView(stateDir, { now: resetAt + 1 }).codex.state).toBe('HEALTHY');
    releasePermit(stateDir, 'codex');
  });

  test('EXHAUSTED (no parseable reset) decays after the bounded latch TTL (review finding 3)', () => {
    // A heuristic "quota" match without a usable reset time must not latch
    // Codex offline forever: after CODEX_EXHAUSTED_LATCH_TTL_MS the next
    // acquire self-heals and the provider truth is re-observed.
    const now = Date.now();
    observeCodexOutcome(stateDir, { event: 'exhausted', resetAt: null, now });
    expect(acquirePermit(stateDir, 'codex', { now: now + 60_000 }).ok).toBe(false);
    expect(
      acquirePermit(stateDir, 'codex', { now: now + CODEX_EXHAUSTED_LATCH_TTL_MS - 1 }).ok,
    ).toBe(false);
    const healed = acquirePermit(stateDir, 'codex', { now: now + CODEX_EXHAUSTED_LATCH_TTL_MS });
    expect(healed.ok).toBe(true);
    expect(providerAdmissionView(stateDir).codex.state).toBe('HEALTHY');
    releasePermit(stateDir, 'codex');
  });
});

describe('AGY bounded pool', () => {
  test('AGY permits bounded and releasable', () => {
    for (let i = 0; i < 3; i++) expect(acquirePermit(stateDir, 'agy').ok).toBe(true);
    expect(acquirePermit(stateDir, 'agy').ok).toBe(false);
    releasePermit(stateDir, 'agy');
    expect(acquirePermit(stateDir, 'agy').ok).toBe(true);
  });
});
