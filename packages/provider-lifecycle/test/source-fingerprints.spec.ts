/**
 * T122: source fingerprints (FR-PROV-010). Six behavioral kinds over
 * canonical-JSON payloads reduced to sha256; the INV-009 retry fence dedupes
 * identical recomputation while genuinely different (drifted) recomputations
 * are preserved as NEW evidence rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Text } from '@foresift/persistence';
import { SourceFingerprintStore, PROVIDER_FINGERPRINT_KINDS, ProvErrorCode } from '../src/index.ts';
import type { OperationTarget } from '../src/index.ts';
import { makeProvEngine, seedOperationRow, ts } from './helpers.ts';

let engine: Awaited<ReturnType<typeof makeProvEngine>>['engine'];
let closeDb: () => Promise<void>;
let store: SourceFingerprintStore;

const TARGET: OperationTarget = { providerId: 'prov-test', operationId: 'op-fp', version: 'v1' };

beforeAll(async () => {
  const made = await makeProvEngine();
  engine = made.engine;
  closeDb = () => made.db.close();
  store = new SourceFingerprintStore({
    engine,
    clock: {
      now: () => ts('2026-08-26T12:00:00Z'),
      nowEpochMs: () => Date.parse('2026-08-26T12:00:00Z'),
    },
  });
  await seedOperationRow(engine, { providerId: 'prov-test', operationId: 'op-fp', version: 'v1' });
});

afterAll(async () => {
  await closeDb();
});

describe('T122 source fingerprints', () => {
  it('accepts all six kinds and hashes the CANONICAL payload form', async () => {
    for (const kind of PROVIDER_FINGERPRINT_KINDS) {
      const record = await store.record({
        target: TARGET,
        kind,
        payload: { kind, sample: 'payload-with-spaces   ', n: 1 },
      });
      expect(record.created).toBe(true);
      expect(record.fingerprintSha256.startsWith('sha256:')).toBe(true);
      // Canonical JSON carries NO STRUCTURAL whitespace (payload values are
      // preserved verbatim).
      expect(record.canonicalPayload).not.toMatch(/[:,]\s/);
      expect(record.fingerprintSha256).toBe(sha256Text(record.canonicalPayload));
      expect(record.fingerprintId.startsWith('psf:')).toBe(true);
    }
  });

  it('identical recomputation dedupes to the SAME row (retry fence)', async () => {
    const payload = { upstream: 'gmgn', correlation: 0.42 };
    const first = await store.record({ target: TARGET, kind: 'VALUE_CORRELATION', payload });
    const retry = await store.record({ target: TARGET, kind: 'VALUE_CORRELATION', payload });
    expect(retry.fingerprintId).toBe(first.fingerprintId);
    expect(retry.created).toBe(false);
    // Exactly ONE storage row carries THIS hash (other suites may add others).
    const rows = await engine.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM prov.prov_source_fingerprints
       WHERE provider_id='prov-test' AND operation_id='op-fp'
         AND kind='VALUE_CORRELATION' AND fingerprint_sha256 = $1`,
      [first.fingerprintSha256],
    );
    expect(Number(rows.rows[0]?.n ?? '0')).toBe(1);
  });

  it('a DIFFERENT recomputation of the same kind is preserved as new evidence (drift)', async () => {
    const drifted = await store.record({
      target: TARGET,
      kind: 'TIMING_BEHAVIOR',
      payload: { p50Ms: 120 },
    });
    const later = await store.record({
      target: TARGET,
      kind: 'TIMING_BEHAVIOR',
      payload: { p50Ms: 480 },
    });
    expect(later.fingerprintId).not.toBe(drifted.fingerprintId);
    expect(later.created).toBe(true);
    // Both drifted generations coexist as DISTINCT evidence rows (earlier
    // suites may have added more for this kind).
    const fresh = [drifted.fingerprintSha256, later.fingerprintSha256];
    const list = await store.list(TARGET);
    const stored = new Set(
      list.filter((f) => f.kind === 'TIMING_BEHAVIOR').map((f) => f.fingerprintSha256),
    );
    for (const hash of fresh) expect(stored.has(hash)).toBe(true);
  });

  it('refuses unknown kinds and non-object payloads', async () => {
    await expect(
      store.record({
        target: TARGET,
        kind: 'TELEPATHY' as never,
        payload: { ok: true },
      }),
    ).rejects.toThrow();
    await expect(
      store.record({ target: TARGET, kind: 'UPSTREAM_LINEAGE', payload: [1, 2] as never }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_FINGERPRINT_PAYLOAD_NOT_CANONICAL });
  });

  it('records estimator input provenance refs', async () => {
    const record = await store.record({
      target: TARGET,
      kind: 'OUTAGE_CORRELATION',
      payload: { overlapMinutes: 33 },
      estimatorInputRefs: ['obs:111', 'obs:222'],
    });
    const rows = await engine.query<{ estimator_input_refs: string[] }>(
      `SELECT estimator_input_refs FROM prov.prov_source_fingerprints
       WHERE provider_id='prov-test' AND operation_id='op-fp'
         AND fingerprint_sha256 = $1`,
      [record.fingerprintSha256],
    );
    expect(rows.rows[0]?.estimator_input_refs).toEqual(['obs:111', 'obs:222']);
  });
});
