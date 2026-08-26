// Source fingerprints (FR-PROV-010): canonical-JSON hashing with monotonic
// per-(operation, kind) versions, canonical-form enforcement, and estimator
// input references.
import { describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import { makeProvStack, closeProvStack, seedOperation, T0 } from './helpers.ts';

const at = (iso: string) => iso as UtcTimestamp;

describe('source fingerprints', () => {
  it('hashes canonical JSON so key order never changes the address', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      const a = await stack.fingerprints.capture({
        fingerprintId: 'fp-a',
        ref: op,
        kind: 'UPSTREAM_LINEAGE',
        payload: { upstream: ['feed-b'], depth: 2 },
        computedAt: T0,
        estimatorInputs: { dependence_estimator: 'v0' },
      });
      const b = await stack.fingerprints.capture({
        fingerprintId: 'fp-b',
        ref: op,
        kind: 'UPSTREAM_LINEAGE',
        // Same facts, different key order + spacing.
        payload: '{\"depth\":2,\"upstream\":[\"feed-b\"]}',
        computedAt: T0,
      });
      expect(a.payloadSha256).toBe(b.payloadSha256);
      expect(a.payloadCanonical).toBe('{"depth":2,"upstream":["feed-b"]}');
      expect(a.payloadSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
      await closeProvStack(stack);
    }
  });

  it('refuses non-canonical pre-stringified payloads', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await expect(
        stack.fingerprints.capture({
          fingerprintId: 'fp-noncanon',
          ref: op,
          kind: 'TIMING_BEHAVIOR',
          payload: '{\"b\":1, \"a\":2}', // valid JSON, NOT canonical
          computedAt: T0,
        }),
      ).rejects.toMatchObject({ code: 'PROV_FINGERPRINT_PAYLOAD_NOT_CANONICAL' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('versions monotonically per (operation, kind) and replays return stored rows', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      const first = await stack.fingerprints.capture({
        fingerprintId: 'fp-1',
        ref: op,
        kind: 'OUTAGE_CORRELATION',
        payload: { windowHours: 24, overlapPct: 3 },
        computedAt: T0,
      });
      expect(first.version).toBe(1);
      const second = await stack.fingerprints.capture({
        fingerprintId: 'fp-2',
        ref: op,
        kind: 'OUTAGE_CORRELATION',
        payload: { windowHours: 24, overlapPct: 5 },
        computedAt: at('2026-08-02T00:00:00Z'),
      });
      expect(second.version).toBe(2);
      // A DIFFERENT kind starts its own version line.
      const otherKind = await stack.fingerprints.capture({
        fingerprintId: 'fp-3',
        ref: op,
        kind: 'VALUE_CORRELATION',
        payload: { pearson: 0.4 },
        computedAt: T0,
      });
      expect(otherKind.version).toBe(1);

      const replay = await stack.fingerprints.capture({
        fingerprintId: 'fp-1',
        ref: op,
        kind: 'OUTAGE_CORRELATION',
        payload: { windowHours: 999 },
        computedAt: T0,
      });
      expect(replay.version).toBe(1);
      expect(replay.payloadCanonical).toBe(first.payloadCanonical);

      const history = await stack.fingerprints.history(op, 'OUTAGE_CORRELATION');
      expect(history.map((f) => f.version)).toEqual([1, 2]);
      expect((await stack.fingerprints.latest(op, 'OUTAGE_CORRELATION'))?.version).toBe(2);
    } finally {
      await closeProvStack(stack);
    }
  });

  it('refuses kinds outside the six-kind alphabet', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await expect(
        stack.fingerprints.capture({
          fingerprintId: 'fp-x',
          ref: op,
          kind: 'VIBES' as never,
          payload: {},
          computedAt: T0,
        }),
      ).rejects.toMatchObject({ code: 'PROV_FINGERPRINT_KIND_UNKNOWN' });
    } finally {
      await closeProvStack(stack);
    }
  });
});
