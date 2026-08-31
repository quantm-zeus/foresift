// Hyperdrive H3 P1-7 — global ready queue + work stealing regressions:
// priority-ordered queue construction with exact preflight records, exact
// co-run gating (upgrade + conservative degrade), and the re-enterable
// stealNext pop loop.
import { describe, test, expect } from 'bun:test';
import {
  buildReadyQueue,
  exactCoRunGate,
  stealNext,
  READY_QUEUE_SCHEMA,
} from '../../scripts/automation/ready-queue.mjs';

const exactRec = (packageId: string, predictedWrites: string[]) => ({
  packageId,
  exact: true,
  predictedWrites,
});
const unknownRec = (packageId: string) => ({ packageId, exact: false, predictedWrites: [] });

describe('buildReadyQueue', () => {
  test('priority order preserved; preflight memoized per package', () => {
    const calls: string[] = [];
    const queue = buildReadyQueue(['b', 'a', 'b'], (id) => {
      calls.push(id);
      return exactRec(id, [`packages/${id}/src/x.ts`]);
    });
    expect(calls).toEqual(['b', 'a']);
    expect(queue.schema).toBe(READY_QUEUE_SCHEMA);
    expect(queue.entries.map((e) => e.packageId)).toEqual(['b', 'a']);
    const bRec = queue.byId.get('b')!.preflight as { exact: boolean };
    expect(bRec.exact).toBe(true);
  });

  test('preflight failure degrades conservatively inside the queue', () => {
    const queue = buildReadyQueue(['broken'], () => ({
      packageId: 'broken',
      exact: false,
      predictedWrites: [] as string[],
      reason: 'tasks.md missing',
    }));
    expect((queue.entries[0]!.preflight as { exact: boolean }).exact).toBe(false);
  });
});

describe('exactCoRunGate', () => {
  test('disjoint exact writes pass; overlapping exact writes refuse with the colliding path', () => {
    const gate = exactCoRunGate(exactRec('a', ['packages/a/src/x.ts']), [
      exactRec('b', ['packages/b/src/y.ts']),
    ]);
    expect(gate.ok).toBe(true);
    const refuse = exactCoRunGate(exactRec('a', ['packages/a/src/x.ts']), [
      exactRec('b', ['packages/a/src/x.ts']),
    ]);
    expect(refuse.ok).toBe(false);
    expect(refuse.reason).toContain('packages/a/src/x.ts');
  });

  test('unknown truth on either side degrades (never blocks, never upgrades)', () => {
    const mixed = exactCoRunGate(exactRec('a', ['packages/a/src/x.ts']), [unknownRec('b')]);
    expect(mixed.ok).toBe(true);
    const reverse = exactCoRunGate(unknownRec('a'), [exactRec('b', ['packages/a/src/x.ts'])]);
    expect(reverse.ok).toBe(true);
  });
});

describe('stealNext', () => {
  test('returns the first admitted candidate and removes it from the queue', () => {
    const queue = buildReadyQueue(['a', 'b', 'c'], (id) => exactRec(id, []));
    const stolen: string[] = [];
    const first = stealNext(queue, (entry) => {
      stolen.push(entry.packageId);
      return entry.packageId === 'a' ? null : { id: entry.packageId };
    });
    expect(stolen).toEqual(['a', 'b']);
    expect(first).toEqual({ id: 'b' });
    // A SKIPPED candidate ('a') stays queued for later passes; only claimed
    // entries are consumed.
    const second = stealNext(queue, (entry) => ({ id: entry.packageId }));
    expect(second).toEqual({ id: 'a' });
    expect(stealNext(queue, () => true)).toEqual(true); // returns the admit result verbatim
    expect(stealNext(queue, () => true)).toBeNull();
  });
});
