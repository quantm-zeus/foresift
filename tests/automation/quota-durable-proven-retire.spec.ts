// Durable-PROVEN retirement of a stale quota pause (incident 2026-09-11, run
// ad794228 / package g1-objective-governance): the package's product + state
// PRs landed while its tracked run sat terminal under a QUOTA_DAILY pause.
// The quota probe schedule exists to eventually RESUME the run so the package
// can land — once the package is already PROVEN on committed main, resuming
// the terminal run resurrects dead provider spend against proven truth.
//
// Laws under test (retireQuotaPauseOnDurableProven):
//   1. PROVEN package + terminal/no run row + quota-paused entry
//      => entry retired (done, runtime released), NO resume attempted.
//   2. A live (running/pending) sibling row for the same package still owns
//      the work — retire REFUSES (fail-closed against double-tracking).
//   3. A non-PROVEN package is untouched: the quota schedule keeps its
//      ordinary behavior (no retirement, no resume from this helper).
import { describe, test, expect } from 'bun:test';

const { retireQuotaPauseOnDurableProven } =
  await import('../../scripts/automation/foresift-autopilot.mjs');

function milestoneState(status: string) {
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
        status,
      },
    ],
  };
}

function quotaEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'package',
    workflow: 'foresift-sharded-wave',
    runId: 'dead-run-0000',
    packageId: 'pkg-a',
    branch: 'foresift/pkg-a',
    message: 'pkg-a',
    startedAt: 1_000,
    paused: 'quota',
    failureClass: 'QUOTA_DAILY',
    lastPauseReason: 'failed: writer-shard-1-claude failed [exit 1]',
    quotaNextProbeAt: 2_000,
    quotaProbes: 0,
    ...overrides,
  };
}

const RESUME_SPY = () => {
  const calls: string[] = [];
  return {
    calls,
    archonJson: (args: string) => {
      calls.push(args);
      return { ok: true };
    },
  };
};

function harness({
  ms = milestoneState('PROVEN'),
  runRow = null,
}: { ms?: unknown; runRow?: Record<string, unknown> | null } = {}) {
  const spy = RESUME_SPY();
  const st: { events: Array<Record<string, unknown>> } = { events: [] };
  const deps = {
    loadMilestone: () => ms,
    findRunRow: () => runRow,
    record: (_state: unknown, event: string, detail?: Record<string, unknown>) => {
      st.events.push({ event, ...detail });
    },
  };
  return { st, deps, spy };
}

describe('durable-PROVEN retirement of stale quota pauses (actOnPausedEntry preemption)', () => {
  test('law 1: PROVEN + terminal row + quota pause => retire, done, runtime release, NO resume', () => {
    const { st, deps, spy } = harness({ runRow: { id: 'dead-run-0000', status: 'failed' } });
    const entry = quotaEntry();
    const retired = retireQuotaPauseOnDurableProven(st as never, entry as never, deps as never);
    expect(retired).toBe(true);
    expect(entry.done).toBe(true);
    expect(entry.note).toBe('quota_pause_retired_durable_proven');
    expect(entry.paused).toBe('quota'); // marked done, not re-paused
    expect(st.events.some((e) => e.event === 'quota_pause_retired_durable_proven')).toBe(true);
    // The whole point: no workflow resume may be attempted against proven truth.
    expect(spy.calls).toEqual([]);
  });

  test('law 1b: PROVEN + NO run row + quota pause => same retirement', () => {
    const { st, deps } = harness({ runRow: null });
    const entry = quotaEntry();
    expect(retireQuotaPauseOnDurableProven(st as never, entry as never, deps as never)).toBe(true);
    expect(entry.done).toBe(true);
    expect(st.events.some((e) => e.event === 'quota_pause_retired_durable_proven')).toBe(true);
  });

  test('law 2: live sibling run for the PROVEN package => refuse to retire (fail-closed)', () => {
    const { st, deps } = harness({
      runRow: { id: 'live-run-9999', status: 'running' },
    });
    const entry = quotaEntry();
    expect(retireQuotaPauseOnDurableProven(st as never, entry as never, deps as never)).toBe(false);
    expect(entry.done).toBeUndefined();
    expect(st.events).toEqual([]);
  });

  test('law 2b: pending sibling run likewise refuses retirement', () => {
    const { st, deps } = harness({ runRow: { id: 'live-run-9999', status: 'pending' } });
    const entry = quotaEntry();
    expect(retireQuotaPauseOnDurableProven(st as never, entry as never, deps as never)).toBe(false);
    expect(entry.done).toBeUndefined();
  });

  test('law 3: non-PROVEN (RUNNING/PENDING/FAILED) package => no opinion, quota behavior unchanged', () => {
    for (const status of ['RUNNING', 'PENDING']) {
      const { st, deps } = harness({ ms: milestoneState(status), runRow: null });
      const entry = quotaEntry();
      expect(retireQuotaPauseOnDurableProven(st as never, entry as never, deps as never)).toBe(
        false,
      );
      expect(entry.done).toBeUndefined();
      expect(st.events).toEqual([]);
    }
  });

  test('law 3b: package absent from milestone / unreadable milestone => no opinion', () => {
    const absent = milestoneState('PROVEN');
    (absent as { packages: Array<{ id: string }> }).packages[0]!.id = 'pkg-other';
    const { st: stAbsent, deps: depsAbsent } = harness({ ms: absent, runRow: null });
    expect(
      retireQuotaPauseOnDurableProven(
        stAbsent as never,
        quotaEntry() as never,
        depsAbsent as never,
      ),
    ).toBe(false);
    const { st: stThrow, deps: depsThrow } = harness();
    depsThrow.loadMilestone = () => {
      throw new Error('unreadable');
    };
    expect(
      retireQuotaPauseOnDurableProven(stThrow as never, quotaEntry() as never, depsThrow as never),
    ).toBe(false);
  });

  test('law 3c: non-quota or done or package-less entries are ignored', () => {
    const { st, deps } = harness();
    expect(
      retireQuotaPauseOnDurableProven(
        st as never,
        quotaEntry({ paused: 'fatal' }) as never,
        deps as never,
      ),
    ).toBe(false);
    expect(
      retireQuotaPauseOnDurableProven(
        st as never,
        quotaEntry({ paused: null, done: true }) as never,
        deps as never,
      ),
    ).toBe(false);
    expect(
      retireQuotaPauseOnDurableProven(
        st as never,
        quotaEntry({ packageId: null }) as never,
        deps as never,
      ),
    ).toBe(false);
  });
});
