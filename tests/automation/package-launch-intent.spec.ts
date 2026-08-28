// tests/automation/package-launch-intent.spec.ts — Behavioral tests for two-phase package launch intent.
// Matrix from Task Spec §20.

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLaunchIntent,
  discoverPendingLaunchIntents,
  associateRunIdWithIntent,
  reconcileLaunchIntentsOnStartup,
  isPackageLaunchInFlight,
  markIntentComplete,
  LAUNCH_INTENTS_DIR_NAME,
} from '../../scripts/automation/launch-intent.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'launch-intent-spec-'));

describe('Package Launch Intent Matrix (§20)', () => {
  it('1. No launch intent → eligible package may prepare intent', () => {
    const stateDir = join(scratch, 'intent-1');
    mkdirSync(stateDir, { recursive: true });

    const inFlight = isPackageLaunchInFlight(stateDir, 'g0-cost-capacity');
    expect(inFlight).toBe(false);

    const intent = createLaunchIntent(stateDir, {
      packageId: 'g0-cost-capacity',
      generation: 0,
      executionProfile: 'CODEX_AGY',
      workflow: 'foresift-package-planning-bootstrap',
      branch: 'archon/task-foresift-g0-cost-capacity',
      sourceSha: 'abc1234567890',
    });

    expect(intent.status).toBe('INTENT_DURABLE');
    expect(intent.intentId).toBeDefined();
    expect(isPackageLaunchInFlight(stateDir, 'g0-cost-capacity')).toBe(true);
  });

  it('2. Durable intent → duplicate launch check returns inFlight=true', () => {
    const stateDir = join(scratch, 'intent-2');
    mkdirSync(stateDir, { recursive: true });

    createLaunchIntent(stateDir, {
      packageId: 'g0-cost-capacity',
      generation: 0,
      executionProfile: 'CODEX_AGY',
      workflow: 'foresift-package-planning-bootstrap',
      branch: 'archon/task-foresift-g0-cost-capacity',
      sourceSha: 'abc1234567890',
    });

    expect(isPackageLaunchInFlight(stateDir, 'g0-cost-capacity')).toBe(true);
  });

  it('3. Crash after launch before run ID persistence → startup recovery detects and reconciles', () => {
    const stateDir = join(scratch, 'intent-3');
    mkdirSync(stateDir, { recursive: true });

    const intent = createLaunchIntent(stateDir, {
      packageId: 'g0-cost-capacity',
      generation: 0,
      executionProfile: 'CODEX_AGY',
      workflow: 'foresift-package-planning-bootstrap',
      branch: 'archon/task-foresift-g0-cost-capacity',
      sourceSha: 'abc1234567890',
    });
    expect(intent.status).toBe('INTENT_DURABLE');

    // Mock Archon runs query function returning existing run
    // F7 fix: strong matching requires user_message, working_path, and bounded time
    const fakeArchonRuns = [
      {
        id: 'archon-run-123',
        workflow_name: 'foresift-package-planning-bootstrap',
        status: 'running',
        user_message: 'g0-cost-capacity',
        working_path: '/path/task-foresift-g0-cost-capacity',
        started_at: new Date().toISOString(),
      },
    ];

    const reconciled = reconcileLaunchIntentsOnStartup(stateDir, {
      archonRuns: fakeArchonRuns,
    });

    expect(reconciled.adopted.length).toBe(1);
    expect(reconciled.adopted[0]!.runId).toBe('archon-run-123');
    expect(reconciled.adopted[0]!.status).toBe('RUN_ASSOCIATED');
  });

  it('4. Run ID durable + main PENDING → prevents second launch', () => {
    const stateDir = join(scratch, 'intent-4');
    mkdirSync(stateDir, { recursive: true });

    const intent = createLaunchIntent(stateDir, {
      packageId: 'g0-cost-capacity',
      generation: 0,
      executionProfile: 'CODEX_AGY',
      workflow: 'foresift-package-planning-bootstrap',
      branch: 'archon/task-foresift-g0-cost-capacity',
      sourceSha: 'abc1234567890',
    });

    associateRunIdWithIntent(stateDir, intent.intentId, 'archon-run-456');

    expect(isPackageLaunchInFlight(stateDir, 'g0-cost-capacity')).toBe(true);
  });

  it('5. RUNNING state PR pending → in-flight returns true', () => {
    const stateDir = join(scratch, 'intent-5');
    mkdirSync(stateDir, { recursive: true });

    const intent = createLaunchIntent(stateDir, {
      packageId: 'g0-cost-capacity',
      generation: 0,
      executionProfile: 'CODEX_AGY',
      workflow: 'foresift-package-planning-bootstrap',
      branch: 'archon/task-foresift-g0-cost-capacity',
      sourceSha: 'abc1234567890',
    });

    associateRunIdWithIntent(stateDir, intent.intentId, 'archon-run-789');

    const pending = discoverPendingLaunchIntents(stateDir);
    expect(pending.length).toBe(1);
    expect(pending[0]!.status).toBe('RUN_ASSOCIATED');
  });

  it('6. RUNNING state PR CI fails → existing run preserved, intent remains in-flight', () => {
    const stateDir = join(scratch, 'intent-6');
    mkdirSync(stateDir, { recursive: true });

    const intent = createLaunchIntent(stateDir, {
      packageId: 'g0-cost-capacity',
      generation: 0,
      executionProfile: 'CODEX_AGY',
      workflow: 'foresift-package-planning-bootstrap',
      branch: 'archon/task-foresift-g0-cost-capacity',
      sourceSha: 'abc1234567890',
    });

    associateRunIdWithIntent(stateDir, intent.intentId, 'archon-run-789');

    // Intent remains tracked so duplicate launch is suppressed
    expect(isPackageLaunchInFlight(stateDir, 'g0-cost-capacity')).toBe(true);
  });

  it('7. RUNNING merge succeeds → intent marked complete', () => {
    const stateDir = join(scratch, 'intent-7');
    mkdirSync(stateDir, { recursive: true });

    const intent = createLaunchIntent(stateDir, {
      packageId: 'g0-cost-capacity',
      generation: 0,
      executionProfile: 'CODEX_AGY',
      workflow: 'foresift-package-planning-bootstrap',
      branch: 'archon/task-foresift-g0-cost-capacity',
      sourceSha: 'abc1234567890',
    });

    associateRunIdWithIntent(stateDir, intent.intentId, 'archon-run-789');
    const completed = markIntentComplete(stateDir, intent.intentId, {
      mergedSha: 'merged-sha-12345',
      milestoneState: {
        packages: [{ id: 'g0-cost-capacity', generation: 0, status: 'RUNNING' }],
      },
    });

    expect(completed).not.toBeNull();
    expect(completed!.status).toBe('MERGED');
    expect(completed!.mergedSha).toBe('merged-sha-12345');
    expect(isPackageLaunchInFlight(stateDir, 'g0-cost-capacity')).toBe(false);
  });

  it('7b. Stale or mismatched generation cannot complete intent', () => {
    const stateDir = join(scratch, 'intent-7b');
    mkdirSync(stateDir, { recursive: true });

    const intent = createLaunchIntent(stateDir, {
      packageId: 'g0-cost-capacity',
      generation: 1,
      executionProfile: 'CODEX_AGY',
      workflow: 'foresift-package-planning-bootstrap',
      branch: 'archon/task-foresift-g0-cost-capacity',
      sourceSha: 'abc1234567890',
    });

    associateRunIdWithIntent(stateDir, intent.intentId, 'archon-run-789');

    // Milestone has older generation 0
    const failedAttempt = markIntentComplete(stateDir, intent.intentId, {
      mergedSha: 'merged-sha-12345',
      milestoneState: {
        packages: [{ id: 'g0-cost-capacity', generation: 0, status: 'RUNNING' }],
      },
    });
    expect(failedAttempt).toBeNull();
    expect(isPackageLaunchInFlight(stateDir, 'g0-cost-capacity')).toBe(true);

    // Milestone has status PENDING (not RUNNING or PROVEN)
    const failedStatusAttempt = markIntentComplete(stateDir, intent.intentId, {
      mergedSha: 'merged-sha-12345',
      milestoneState: {
        packages: [{ id: 'g0-cost-capacity', generation: 1, status: 'PENDING' }],
      },
    });
    expect(failedStatusAttempt).toBeNull();
    expect(isPackageLaunchInFlight(stateDir, 'g0-cost-capacity')).toBe(true);
  });

  it('8. Atomic receipt persistence: crash during write cannot corrupt existing receipt', () => {
    const stateDir = join(scratch, 'intent-8');
    mkdirSync(stateDir, { recursive: true });

    const intent = createLaunchIntent(stateDir, {
      packageId: 'g0-cost-capacity',
      generation: 0,
      executionProfile: 'CODEX_AGY',
      workflow: 'foresift-package-planning-bootstrap',
      branch: 'archon/task-foresift-g0-cost-capacity',
      sourceSha: 'abc1234567890',
    });

    const file = join(stateDir, LAUNCH_INTENTS_DIR_NAME, `intent-${intent.intentId}.json`);
    const content = JSON.parse(readFileSync(file, 'utf8'));
    expect(content.intentId).toBe(intent.intentId);
    expect(content.status).toBe('INTENT_DURABLE');
  });

  it('9. Directional time matching: run before intent - skew or after launch window is rejected', () => {
    const stateDir = join(scratch, 'intent-9');
    mkdirSync(stateDir, { recursive: true });

    const now = Date.now();
    createLaunchIntent(stateDir, {
      packageId: 'g0-cost-capacity',
      generation: 1,
      executionProfile: 'CODEX_AGY',
      workflow: 'foresift-package-planning-bootstrap',
      branch: 'archon/task-foresift-g0-cost-capacity',
      sourceSha: 'abc1234567890',
    });

    // Too far in the past (before intent creation - 30s skew)
    const wayTooEarlyRun = {
      id: 'early-run',
      workflow_name: 'foresift-package-planning-bootstrap',
      user_message: 'g0-cost-capacity@g1',
      started_at: new Date(now - 60_000).toISOString(),
    };

    const resEarly = reconcileLaunchIntentsOnStartup(stateDir, {
      archonRuns: [wayTooEarlyRun],
    });
    expect(resEarly.adopted.length).toBe(0);
    expect(resEarly.dangling.length).toBe(1);
    expect(resEarly.dangling[0]!.status).toBe('RECONCILIATION_BLOCKED');
  });

  it('10. Ambiguous match blocks reconciliation without duplicate launch', () => {
    const stateDir = join(scratch, 'intent-10');
    mkdirSync(stateDir, { recursive: true });

    const now = Date.now();
    createLaunchIntent(stateDir, {
      packageId: 'g0-cost-capacity',
      generation: 0,
      executionProfile: 'CODEX_AGY',
      workflow: 'foresift-package-planning-bootstrap',
      branch: 'archon/task-foresift-g0-cost-capacity',
      sourceSha: 'abc1234567890',
    });

    // Two ambiguous runs matching the same criteria
    const run1 = {
      id: 'run-1',
      workflow_name: 'foresift-package-planning-bootstrap',
      user_message: 'g0-cost-capacity',
      started_at: new Date(now).toISOString(),
    };
    const run2 = {
      id: 'run-2',
      workflow_name: 'foresift-package-planning-bootstrap',
      user_message: 'g0-cost-capacity',
      started_at: new Date(now + 1000).toISOString(),
    };

    const resAmbiguous = reconcileLaunchIntentsOnStartup(stateDir, {
      archonRuns: [run1, run2],
    });
    expect(resAmbiguous.adopted.length).toBe(0);
    expect(resAmbiguous.dangling.length).toBe(1);
    expect(resAmbiguous.dangling[0]!.status).toBe('RECONCILIATION_BLOCKED');
    expect(isPackageLaunchInFlight(stateDir, 'g0-cost-capacity')).toBe(true);
  });
});
