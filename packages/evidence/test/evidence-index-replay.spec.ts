/**
 * Frozen evidence bundles and the shared replay-boundary resolver
 * (T040, FR-DATA-003, FR-DATA-002): content addressing is canonical (key
 * order never matters), freezing is one-way, tampering is detectable, and
 * boundary resolution over bundles + observations uses THE domain predicate.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { chainIdentity, ErrorCode, ForesiftError, utcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  appendRevision,
  applyMigrations,
  createEngine,
  ensureChain,
  insertDex,
  insertPool,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
  type ObservationInput,
} from '@foresift/persistence';
import {
  freezeBundle,
  loadFrozenBundle,
  manifestContentHash,
  resolveEvidenceAt,
  verifyBundleIntegrity,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  await ensureChain(engine, 'eip155:1');
  await insertDex(engine, 'eip155:1', 'uniswap');
  await insertPool(engine, {
    chainId: chainIdentity({ chainId: 'eip155:1' }).chainId,
    dexId: 'uniswap',
    poolAddress: '0x00000000000000000000000000000000c0ffee01',
  });

  // Observation timeline with a revision: base available 12:00, revision
  // available 16:00 — resolution at 13:00 vs 17:00 must differ.
  const base: ObservationInput = {
    observationId: 'obs_ev_1',
    subjectPoolId: 'eip155:1/uniswap/0x00000000000000000000000000000000c0ffee01',
    eventAt: utcTimestamp('2026-03-01T11:00:00Z'),
    availableAt: utcTimestamp('2026-03-01T12:00:00Z'),
    sourceObservedAt: utcTimestamp('2026-03-01T10:59:58Z'),
    fetchedAt: utcTimestamp('2026-03-01T11:59:59Z'),
    ingestedAt: utcTimestamp('2026-03-01T12:00:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '1000',
    decimals: 18,
    qualityCodes: [],
    coordinates: {
      chainId: 'eip155:1',
      blockNumberOrSlot: '19000300',
      blockHash: '0x' + 'ab'.repeat(32),
      transactionHash: '0x' + '12'.repeat(32),
      transactionIndex: 2,
      confirmationLevel: 'FINALIZED',
    },
  };
  await appendObservation(engine, base);
  await appendRevision(engine, {
    revisionId: 'rev_ev_1a',
    observationId: 'obs_ev_1',
    availableAt: utcTimestamp('2026-03-01T16:00:00Z'),
    reason: 'PROVIDER_CORRECTION',
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '1200',
    decimals: 18,
  });

  // Bundles: one frozen before the boundary, one after.
  await freezeBundle(engine, {
    bundleId: 'bundle-early',
    manifest: { family: 'DEX_TRADES', items: ['e1', 'e2'] },
    frozenAt: utcTimestamp('2026-03-01T10:00:00Z'),
  });
  await freezeBundle(engine, {
    bundleId: 'bundle-late',
    manifest: { family: 'SOCIAL', items: ['s1'] },
    frozenAt: utcTimestamp('2026-03-02T10:00:00Z'),
  });
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

describe('content-addressed frozen bundles (T040)', () => {
  it('hashes canonical JSON — key order never changes the content address', () => {
    expect(manifestContentHash({ a: 1, b: [2, 3] })).toBe(manifestContentHash({ b: [2, 3], a: 1 }));
    expect(manifestContentHash({ a: 1 })).not.toBe(manifestContentHash({ a: 2 }));
  });

  it('freezes idempotently for identical content and refuses identity conflicts', async () => {
    // Identical content, same id → idempotent verify.
    const again = await freezeBundle(engine, {
      bundleId: 'bundle-early',
      manifest: { items: ['e1', 'e2'], family: 'DEX_TRADES' }, // reordered keys
      frozenAt: utcTimestamp('2026-03-01T10:00:00Z'),
    });
    expect(again.bundleId).toBe('bundle-early');

    // Identical content under a DIFFERENT id is refused — dedup cannot
    // manufacture a second identity for the same bytes (§14.7).
    await expect(
      freezeBundle(engine, {
        bundleId: 'bundle-clone',
        manifest: { family: 'DEX_TRADES', items: ['e1', 'e2'] },
        frozenAt: utcTimestamp('2026-03-01T10:00:00Z'),
      }),
    ).rejects.toThrowError(ForesiftError);

    // Same id with different content is refused — frozen is frozen.
    await expect(
      freezeBundle(engine, {
        bundleId: 'bundle-early',
        manifest: { family: 'DEX_TRADES', items: ['e1', 'e2', 'e3'] },
        frozenAt: utcTimestamp('2026-03-01T10:00:00Z'),
      }),
    ).rejects.toThrowError(ErrorCode.CONTRACT_INVARIANT_VIOLATED);
  });

  it('refuses any mutation of a frozen bundle row', async () => {
    await expect(
      engine.query('UPDATE evidence_bundles SET manifest = $2::jsonb WHERE bundle_id = $1', [
        'bundle-early',
        '{"tampered":true}',
      ]),
    ).rejects.toThrowError();
  });

  it('detects out-of-band manifest tampering as HASH_MISMATCH', async () => {
    expect(await verifyBundleIntegrity(engine, 'bundle-early')).toBe('INTACT');
    // Simulate storage-layer corruption: the DB trigger would normally refuse
    // this write, so it is disabled only to model an out-of-band tamper.
    await engine.query('ALTER TABLE evidence_bundles DISABLE TRIGGER evidence_bundles_immutable');
    await engine.query('UPDATE evidence_bundles SET manifest = $2::jsonb WHERE bundle_id = $1', [
      'bundle-early',
      '{"family":"DEX_TRADES","items":["e1","e2","injected"]}',
    ]);
    await engine.query('ALTER TABLE evidence_bundles ENABLE TRIGGER evidence_bundles_immutable');
    expect(await verifyBundleIntegrity(engine, 'bundle-early')).toBe('HASH_MISMATCH');
    expect(await verifyBundleIntegrity(engine, 'bundle-missing')).toBe('MISSING');
    const reloaded = await loadFrozenBundle(engine, 'bundle-late');
    expect(reloaded!.manifest).toMatchObject({ family: 'SOCIAL' });
  });
});

describe('replay-boundary resolution over bundles + observations (T040)', () => {
  it('includes only bundles and observation revisions visible at T', async () => {
    const at13 = await resolveEvidenceAt(engine, {
      resolvedAt: utcTimestamp('2026-03-01T13:00:00Z'),
    });
    expect(at13.bundles.map((b) => b.bundleId)).toEqual(['bundle-early']);
    expect(at13.observations.map((o) => o.observationId)).toEqual(['obs_ev_1']);
    expect(at13.observations[0]!.availableAt).toBe('2026-03-01T12:00:00Z');

    const at17 = await resolveEvidenceAt(engine, {
      resolvedAt: utcTimestamp('2026-03-01T17:00:00Z'),
    });
    expect(at17.observations[0]!.availableAt).toBe('2026-03-01T16:00:00Z'); // revision now visible
    expect(at17.bundles.map((b) => b.bundleId)).toEqual(['bundle-early']);

    const at12nextDay = await resolveEvidenceAt(engine, {
      resolvedAt: utcTimestamp('2026-03-02T11:00:00Z'),
    });
    expect(at12nextDay.bundles.map((b) => b.bundleId)).toEqual(['bundle-early', 'bundle-late']);
  });
});
