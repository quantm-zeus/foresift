// False pausedFatal after a successful PROVEN landing (incident 2026-09-05,
// package g1-solana-security): the finalize path requests the protected
// RUNNING->PROVEN state transition asynchronously and returns before the
// canonical milestone file lands. The next tick's reconcileStrandedPackages
// saw `RUNNING` + no tracked active run and latched a fatal pause — a false
// positive, because the package had authoritatively completed and the PROVEN
// chore was merely in flight (PR/CI latency is expected behavior, never a
// human-recovery condition).
//
// Laws under test:
//   1. RUNNING + no active run + in-flight ->PROVEN state-landing receipt
//      = awaiting-state-landing, NEVER pausedFatal (case B).
//   2. RUNNING + no active run + NO legitimate state transition = genuine
//      stranded package, pausedFatal (case A) — fail-closed preserved.
//   3. A stale pausedFatal whose package is PROVEN on committed main with no
//      live run is retired deterministically (fatal_pause_retired_by_durable_
//      success) — recognizing durable success superseded the pause, never
//      resuming the terminal run (case C).
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { reconcileStrandedPackages, findProvenLandingReceipt } =
  await import('../../scripts/automation/foresift-autopilot.mjs');

interface ProvenLandingReceipt {
  transitionId?: string;
  packageId?: string;
  fromStatus?: string;
  toStatus?: string;
  status?: string;
  prNumber?: number | string;
  [key: string]: unknown;
}

interface StrandedDeps {
  loadMilestone?: () => unknown;
  loadReceipts?: () => ProvenLandingReceipt[];
  findRunRow?: (workflow: string, message: string) => unknown;
  record?: (st: unknown, event: string, detail?: Record<string, unknown>) => void;
}

const FIXTURES = mkdtempSync(join(tmpdir(), 'stranded-race-'));

function milestoneState(
  overrides: { a?: Record<string, unknown>; b?: Record<string, unknown> } = {},
) {
  return {
    schemaVersion: '1.0.0',
    milestoneId: 'G1',
    status: 'ACTIVE',
    packages: [
      {
        id: 'pkg-a',
        objective: 'fixture package A',
        requirementIds: ['FR-X-001'],
        dependencies: [],
        risk: 'HIGH',
        parallelizable: false,
        writeScopes: ['packages/a/**'],
        verificationCommands: ['true'],
        status: 'RUNNING',
        ...overrides.a,
      },
      {
        id: 'pkg-b',
        objective: 'fixture package B',
        requirementIds: ['FR-X-002'],
        dependencies: ['pkg-a'],
        risk: 'HIGH',
        parallelizable: false,
        writeScopes: ['packages/b/**'],
        verificationCommands: ['true'],
        status: 'PENDING',
        ...overrides.b,
      },
    ],
  };
}

type SupervisorState = {
  activeRuns: Array<Record<string, unknown>>;
  milestoneRuns: Array<Record<string, unknown>>;
  maintenanceRuns: Array<Record<string, unknown>>;
  pausedFatal: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
};

function supervisorState(): SupervisorState {
  return {
    activeRuns: [],
    milestoneRuns: [],
    maintenanceRuns: [],
    pausedFatal: null,
    events: [],
  };
}

// The autopilot's record() pushes {event, ts}; the test state records into a
// plain array for assertions.
function record(
  st: { events: Array<Record<string, unknown>> },
  event: string,
  detail: Record<string, unknown> = {},
) {
  st.events.push({ event, ...detail });
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    transitionId: 'pkg-a-RUNNING-PROVEN-deadbeef-deadbeef',
    packageId: 'pkg-a',
    fromStatus: 'RUNNING',
    toStatus: 'PROVEN',
    status: 'WAITING_CI',
    prNumber: 197,
    createdAt: '2026-09-05T12:00:00.000Z',
    ...overrides,
  };
}

function deps({
  ms = milestoneState(),
  receipts = [],
  runRow = null,
}: {
  ms?: ReturnType<typeof milestoneState>;
  receipts?: ProvenLandingReceipt[];
  runRow?: Record<string, unknown> | null;
} = {}): StrandedDeps {
  return {
    loadMilestone: () => ms,
    loadReceipts: () => receipts,
    findRunRow: () => runRow,
    record: (st, event, detail) =>
      record(st as { events: Array<Record<string, unknown>> }, event, detail ?? {}),
  };
}

describe('false pausedFatal race: state-landing-aware stranded reconciliation', () => {
  test('findProvenLandingReceipt: matches in-flight ->PROVEN receipt for the package', () => {
    const r = receipt();
    expect(findProvenLandingReceipt([r], 'pkg-a')).toEqual(r);
    expect(findProvenLandingReceipt([r], 'pkg-b')).toBeUndefined();
    // A FAILED receipt is terminal and NOT in flight — but a MERGED receipt
    // still proves durable success (canonical may lag the merge).
    const merged = receipt({ status: 'MERGED' });
    expect(findProvenLandingReceipt([merged], 'pkg-a')).toEqual(merged);
    const failed = receipt({ status: 'FAILED' });
    expect(findProvenLandingReceipt([failed], 'pkg-a')).toBeUndefined();
  });

  test('case B: RUNNING + completed run + in-flight ->PROVEN receipt = awaiting-state-landing, NO fatal', () => {
    const st = supervisorState();
    reconcileStrandedPackages(st, deps({ receipts: [receipt()] }));
    expect(st.pausedFatal).toBeNull();
    expect(st.activeRuns.some((e) => e.packageId === 'pkg-a' && e.awaitingStateLanding)).toBe(
      false,
    );
    expect(st.events.some((e) => e.event === 'stranded_awaiting_state_landing')).toBe(true);
  });

  test('case B (merged variant): a MERGED ->PROVEN receipt also blocks the false fatal', () => {
    const st = supervisorState();
    reconcileStrandedPackages(st, deps({ receipts: [receipt({ status: 'MERGED' })] }));
    expect(st.pausedFatal).toBeNull();
    expect(st.events.some((e) => e.event === 'stranded_awaiting_state_landing')).toBe(true);
  });

  test('case A: RUNNING + no active run + NO transition receipt = genuine pausedFatal', () => {
    const st = supervisorState();
    reconcileStrandedPackages(st, deps({ receipts: [] }));
    expect(st.pausedFatal).not.toBeNull();
    expect((st.pausedFatal as { reason: string }).reason).toMatch(
      /pkg-a was RUNNING with no supervisor-tracked active run/,
    );
    expect(st.events.some((e) => e.event === 'stranded_awaiting_state_landing')).toBe(false);
  });

  test('case A preserved: a FAILED ->PROVEN receipt does NOT block the genuine fatal', () => {
    const st = supervisorState();
    reconcileStrandedPackages(st, deps({ receipts: [receipt({ status: 'FAILED' })] }));
    expect(st.pausedFatal).not.toBeNull();
  });

  test('case C: stale pausedFatal whose package is PROVEN on committed main is retired', () => {
    const st = supervisorState();
    st.pausedFatal = {
      reason: 'package pkg-a was RUNNING with no supervisor-tracked active run',
      packageId: 'pkg-a',
      runId: '214ede91',
      since: Date.now(),
    };
    st.activeRuns.push({
      kind: 'package',
      packageId: 'pkg-a',
      runId: '214ede91',
      paused: 'fatal',
    });
    reconcileStrandedPackages(
      st,
      deps({
        ms: milestoneState({ a: { status: 'PROVEN' }, b: { status: 'PENDING' } }),
        receipts: [receipt({ status: 'MERGED' })],
      }),
    );
    expect(st.pausedFatal).toBeNull();
    expect(st.activeRuns).toHaveLength(0);
    expect(st.events.some((e) => e.event === 'fatal_pause_retired_by_durable_success')).toBe(true);
  });

  test('case C is precise: a stale fatal for a still-RUNNING package is NOT retired', () => {
    const st = supervisorState();
    st.pausedFatal = {
      reason: 'package pkg-a was RUNNING with no supervisor-tracked active run',
      packageId: 'pkg-a',
      runId: '214ede91',
      since: Date.now(),
    };
    st.activeRuns.push({ kind: 'package', packageId: 'pkg-a', paused: 'fatal' });
    reconcileStrandedPackages(
      st,
      deps({
        ms: milestoneState(), // pkg-a still RUNNING on canonical
        receipts: [],
      }),
    );
    expect(st.pausedFatal).not.toBeNull();
    expect(st.events.some((e) => e.event === 'fatal_pause_retired_by_durable_success')).toBe(false);
  });
});

// Cleanup only the temp root; fixture state lives in memory.
process.on('exit', () => {
  try {
    rmSync(FIXTURES, { recursive: true, force: true });
  } catch {}
});
