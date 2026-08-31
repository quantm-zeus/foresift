// Hyperdrive H3 P0-4 — real Codex→Claude engine handoff at lane level.
//
// Runtime proofs (hermetic, real pool state files):
//   - Codex quota exhausted (or model unavailable) ⇒ the lane hands off and
//     CLAUDE executes the SAME logical lane (same holder, same worktree
//     identity, same task list);
//   - no two engines own the lane concurrently (codex released before the
//     claude acquire; a denied codex acquire never held anything);
//   - the same generation/package/lane identity is retained end-to-end;
//   - completion evidence flows through the P0-1 nomination protocol over
//     the handoff's actual diff (no duplicate completion, sibling tasks stay
//     open);
//   - transient contention (POOL_AT_LIMIT/PROVIDER_BACKOFF) is NOT a handoff
//     trigger — it may wait via normal retry.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isQuotaHandoffReason,
  isTransientContentionReason,
  executeHandoffToClaude,
  handoffCompletionClaims,
  persistHandoffRecord,
} from '../../scripts/automation/engine-handoff.mjs';
import {
  acquireLanePermit,
  providerAdmissionView,
  observeCodexOutcome,
} from '../../scripts/automation/provider-pool.mjs';
import { unitsIndexFromGraph } from '../../scripts/automation/task-completion-evidence.mjs';

let stateDir: string;
let resultDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'engine-handoff-pool-'));
  resultDir = mkdtempSync(join(tmpdir(), 'engine-handout-artifacts-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(resultDir, { recursive: true, force: true });
});

describe('handoff trigger classification', () => {
  test('true quota exhaustion and model unavailability trigger handoff', () => {
    expect(isQuotaHandoffReason('CODEX_QUOTA_EXHAUSTED')).toBe(true);
    expect(isQuotaHandoffReason('CODEX_QUOTA_RESET_WAIT')).toBe(true);
    expect(isQuotaHandoffReason('REQUIRED_HIGH_MODEL_UNAVAILABLE')).toBe(true);
    expect(isQuotaHandoffReason('CODEX_MODEL_UNAVAILABLE: gpt-5.6-sol')).toBe(true);
  });

  test('transient contention waits instead of handing off', () => {
    expect(isTransientContentionReason('POOL_AT_LIMIT')).toBe(true);
    expect(isTransientContentionReason('PROVIDER_BACKOFF')).toBe(true);
    expect(isQuotaHandoffReason('POOL_AT_LIMIT')).toBe(false);
    expect(isQuotaHandoffReason('PROVIDER_BACKOFF')).toBe(false);
  });
});

describe('handoff choreography (real pool state)', () => {
  const HOLDER = 'pkg-h:0:core';
  const IDENTITY = { packageId: 'pkg-h', generation: 0, laneId: 'core' };

  test('quota-exhausted codex lane hands off: claude executes same logical lane, no dual ownership, same generation retained', () => {
    // Codex pool latched EXHAUSTED ⇒ a codex lane acquire is denied with the
    // quota reason (the trigger). The claude pool has capacity.
    observeCodexOutcome(stateDir, { event: 'exhausted' });
    const codexAcquire = acquireLanePermit(stateDir, HOLDER, 'codex', IDENTITY);
    expect(codexAcquire.ok).toBe(false);
    expect(isQuotaHandoffReason(codexAcquire.reason)).toBe(true);

    let codexHeldDuringClaude: number | null = null;
    const executed = executeHandoffToClaude({
      stateDir,
      holder: HOLDER,
      ...IDENTITY,
      resultDir,
      releaseCodex: false, // denied acquire never held a permit
      executeWithClaude: () => {
        // Invariant: the claude permit is held; NO codex permit is.
        const codexView = providerAdmissionView(stateDir).codex;
        const claudeView = providerAdmissionView(stateDir).claude;
        codexHeldDuringClaude = codexView.active;
        expect(claudeView.active).toBe(1);
        expect(codexView.active).toBe(0);
        return { engine: 'CLAUDE', shardId: 'core', headSha: 'deadbeef' };
      },
    });
    expect(executed).toEqual({ engine: 'CLAUDE', shardId: 'core', headSha: 'deadbeef' });
    expect(codexHeldDuringClaude as unknown).toBe(0);
    // Handoff record persisted (durable execution truth).
    const record = JSON.parse(readFileSync(join(resultDir, 'engine-handoff.json'), 'utf8'));
    expect(record.schema).toBe('foresift/engine-handoff@1');
    expect(record.from).toBe('CODEX');
    expect(record.to).toBe('CLAUDE');
    expect(record.holder).toBe(HOLDER);
    // Claude permit released by the executing core's finally path.
    expect(providerAdmissionView(stateDir).claude.active).toBe(0);
  });

  test('handoff with codex ownership held: codex released BEFORE claude acquired (never two owners)', () => {
    // Simulate the post-invocation exhaustion path: the lane DOES hold the
    // codex permit when the quota latch fires.
    const held = acquireLanePermit(stateDir, HOLDER, 'codex', IDENTITY);
    expect(held.ok).toBe(true);
    observeCodexOutcome(stateDir, { event: 'exhausted' });
    const ownershipTrace: string[] = [];
    executeHandoffToClaude({
      stateDir,
      holder: HOLDER,
      ...IDENTITY,
      resultDir,
      releaseCodex: true,
      executeWithClaude: () => {
        const view = providerAdmissionView(stateDir);
        ownershipTrace.push(`codex=${view.codex.active}`, `claude=${view.claude.active}`);
        // Claude runs only after codex ownership is fully released.
        expect(view.codex.active).toBe(0);
        expect(view.claude.active).toBe(1);
        return 'executed';
      },
    });
    expect(ownershipTrace).toEqual(['codex=0', 'claude=1']);
    expect(providerAdmissionView(stateDir).claude.active).toBe(0);
  });

  test('claude denial during handoff is recorded verbatim and thrown (fail-closed)', () => {
    // Saturate the claude pool BEFORE any pool file exists (observeCodexOutcome
    // materializes pools with defaults; the policy must be present first).
    const policy = JSON.stringify({
      claude: { initial: 1, normalTarget: 1, burstTarget: 1, hardCap: 1 },
    });
    writeFileSync(join(stateDir, 'provider-pools.policy.json'), policy);
    const blocker = acquireLanePermit(stateDir, 'other:0:core', 'claude');
    expect(blocker.ok).toBe(true);
    observeCodexOutcome(stateDir, { event: 'exhausted' });
    expect(() =>
      executeHandoffToClaude({
        stateDir,
        holder: HOLDER,
        ...IDENTITY,
        resultDir,
        releaseCodex: false,
        executeWithClaude: () => 'never',
      }),
    ).toThrow(/ENGINE_HANDOFF_CLAUDE_PERMIT_DENIED/);
    const denial = JSON.parse(readFileSync(join(resultDir, 'permit-denied.json'), 'utf8'));
    expect(denial.provider).toBe('claude');
    expect(denial.handoffFrom).toBe('codex');
    // The pool was never double-counted: claude still just the blocker.
    expect(providerAdmissionView(stateDir).claude.active).toBe(1);
  });
});

describe('handoff completion evidence (P0-1 protocol applies unchanged)', () => {
  test('nominations run over the handoff diff; sibling tasks stay open', () => {
    const units = [
      { id: 'T001', predictedWrites: ['src/a.ts'] },
      { id: 'T002', predictedWrites: ['src/b.ts'] },
    ];
    const claims = handoffCompletionClaims({
      taskIds: ['T001', 'T002'],
      changed: ['src/b.ts'], // the handoff executed only T002's output
      unitsById: unitsIndexFromGraph({ units }),
    });
    expect(claims.nominated).toEqual(['T002']);
    expect(claims.deferred.map((d) => d.taskId)).toEqual(['T001']);
    // unitsById plumbing works via the shared graph index.
    const idx = unitsIndexFromGraph({ units });
    expect(idx.get('T001')?.predictedWrites).toEqual(['src/a.ts']);
    // Evidence-unavailable (no graph, no unitsById) ⇒ NOTHING is nominated.
    const unavailable = handoffCompletionClaims({
      taskIds: ['T001', 'T002'],
      changed: ['src/b.ts'],
      taskGraphPath: null,
    });
    expect(unavailable.nominated).toEqual([]);
    // An empty handoff diff nominates nothing.
    const none = handoffCompletionClaims({
      taskIds: ['T001', 'T002'],
      changed: [],
      unitsById: unitsIndexFromGraph({ units }),
    });
    expect(none.nominated).toEqual([]);
    expect(none.deferred).toHaveLength(2);
  });

  test('handoff record schema is stable and names the lane identity', () => {
    persistHandoffRecord(resultDir, {
      from: 'CODEX',
      to: 'CLAUDE',
      holder: 'pkg-h:0:core',
      reason: 'CODEX_QUOTA_EXHAUSTED',
      at: '2026-08-31T00:00:00.000Z',
    });
    expect(existsSync(join(resultDir, 'engine-handoff.json'))).toBe(true);
    const record = JSON.parse(readFileSync(join(resultDir, 'engine-handoff.json'), 'utf8'));
    expect(record.holder).toBe('pkg-h:0:core');
    expect(record.reason).toBe('CODEX_QUOTA_EXHAUSTED');
  });
});
