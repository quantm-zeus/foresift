/**
 * Source-fingerprint suite (FR-PROV-010; T122): all six kinds capture as
 * versioned, canonically-serialized estimator inputs; equal observations
 * serialize byte-equal regardless of key order; history/latest expose the
 * version chain; non-canonical payloads refuse.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixedClock, utcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { ProvErrorCode, SourceFingerprintService } from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let fingerprints: SourceFingerprintService;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  fingerprints = new SourceFingerprintService({
    engine,
    clock: fixedClock(utcTimestamp('2026-06-01T12:00:00Z')),
  });
});

afterAll(async () => {
  await db.close();
});

describe('versioned canonical capture (T122)', () => {
  it('captures all six kinds with per-kind version chains', async () => {
    for (const kind of [
      'UPSTREAM_LINEAGE',
      'VALUE_CORRELATION',
      'TIMING_BEHAVIOR',
      'OUTAGE_CORRELATION',
      'SCHEMA_CHARACTERISTICS',
      'FIRST_SEEN_BEHAVIOR',
    ] as const) {
      const record = await fingerprints.capture({
        providerId: 'prov-fp',
        operationId: 'op-fp',
        operationVersion: '1.0.0',
        kind,
        payload: { kind, sampleSize: 10 },
        estimatorInputRefs: [`fp-input:${kind}:1`],
      });
      expect(record.fingerprintVersion).toBe(1);
      expect(record.payloadCanonical).toBe(`{"kind":"${kind}","sampleSize":10}`);
    }

    // Second observation of one kind advances ONLY that kind's chain.
    const second = await fingerprints.capture({
      providerId: 'prov-fp',
      operationId: 'op-fp',
      operationVersion: '1.0.0',
      kind: 'TIMING_BEHAVIOR',
      payload: { p50Ms: 120, p99Ms: 400 },
    });
    expect(second.fingerprintVersion).toBe(2);

    const history = await fingerprints.history('prov-fp', 'op-fp', '1.0.0');
    expect(history).toHaveLength(7);
    expect(
      await fingerprints.latest('prov-fp', 'op-fp', '1.0.0', 'TIMING_BEHAVIOR'),
    ).toMatchObject({ fingerprintVersion: 2 });
    expect(
      await fingerprints.latest('prov-fp', 'op-fp', '1.0.0', 'SCHEMA_CHARACTERISTICS'),
    ).toMatchObject({ fingerprintVersion: 1 });

    // Kind-scoped history stays within the kind.
    const timingHistory = await fingerprints.history(
      'prov-fp',
      'op-fp',
      '1.0.0',
      'TIMING_BEHAVIOR',
    );
    expect(timingHistory.map((r) => r.fingerprintVersion)).toEqual([1, 2]);
  });

  it('serializes equal observations byte-equal across key order and captures estimator refs', async () => {
    const a = await fingerprints.capture({
      providerId: 'prov-canonical',
      operationId: 'op-canon',
      operationVersion: '2.0.0',
      kind: 'VALUE_CORRELATION',
      payload: { b: 2, a: { z: 1, y: [1, 2] } },
      estimatorInputRefs: ['store://x', 'store://y'],
    });
    const b = await fingerprints.capture({
      providerId: 'prov-canonical',
      operationId: 'op-canon',
      operationVersion: '2.0.0',
      kind: 'VALUE_CORRELATION',
      payload: { a: { y: [1, 2], z: 1 }, b: 2 },
      estimatorInputRefs: [],
    });
    expect(a.payloadCanonical).toBe(b.payloadCanonical);
    expect(a.estimatorInputRefs).toEqual(['store://x', 'store://y']);
    expect(b.estimatorInputRefs).toEqual([]);
  });

  it('refuses payloads that cannot canonicalize or carry no structure', async () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    await expect(
      fingerprints.capture({
        providerId: 'prov-bad',
        operationId: 'op-bad',
        operationVersion: '1.0.0',
        kind: 'TIMING_BEHAVIOR',
        payload: circular,
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_FINGERPRINT_PAYLOAD_INVALID });

    await expect(
      fingerprints.capture({
        providerId: 'prov-bad',
        operationId: 'op-bad',
        operationVersion: '1.0.0',
        kind: 'TIMING_BEHAVIOR',
        payload: null,
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_FINGERPRINT_PAYLOAD_INVALID });
  });
});
