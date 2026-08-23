/**
 * Observations repository (T025/T026, FR-DATA-002, AC-024/025): append-only
 * writes with content-addressed receipts, revision chains that never touch
 * originals, and reorg/finality compensating events. The database itself
 * refuses UPDATE/DELETE on the immutable tables.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { chainIdentity, utcTimestamp } from '@foresift/domain';
import {
  appendCompensatingEvent,
  appendObservation,
  appendRevision,
  applyMigrations,
  createEngine,
  ensureChain,
  insertDex,
  insertPool,
  loadObservation,
  receiptHashOf,
  type DatabaseEngine,
  type ObservationInput,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite();
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  // The subject pool referenced below must satisfy observations' FK to pools.
  await ensureChain(engine, 'eip155:1');
  await insertDex(engine, 'eip155:1', 'uniswap');
  await insertPool(engine, {
    chainId: chainIdentity({ chainId: 'eip155:1' }).chainId,
    dexId: 'uniswap',
    poolAddress: '0x00000000000000000000000000000000c0ffee01',
  });
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

function baseObservation(observationId: string): ObservationInput {
  return {
    observationId,
    subjectPoolId: 'eip155:1/uniswap/0x00000000000000000000000000000000c0ffee01',
    eventAt: utcTimestamp('2026-01-01T12:00:00Z'),
    availableAt: utcTimestamp('2026-01-01T12:00:05Z'),
    sourceObservedAt: utcTimestamp('2026-01-01T11:59:58Z'),
    fetchedAt: utcTimestamp('2026-01-01T12:00:04Z'),
    ingestedAt: utcTimestamp('2026-01-01T12:00:05Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '1000000000000000000',
    decimals: 18,
    coordinates: {
      chainId: 'eip155:1',
      blockNumberOrSlot: '19000000',
      blockHash: '0x' + 'ab'.repeat(32),
      transactionHash: '0x' + 'cd'.repeat(32),
      transactionIndex: 3,
      confirmationLevel: 'FINALIZED',
    },
    qualityCodes: [],
  };
}

describe('append-only observations with receipt hashes (T025)', () => {
  it('stores an observation whose stored row hashes back to the returned receipt', async () => {
    await appendObservation(engine, baseObservation('obs_r1'));
    const stored = await loadObservation(engine, 'obs_r1');
    expect(stored).not.toBeNull();
    if (stored === null) throw new Error('unreachable');

    // Recompute the hash purely from what the DATABASE holds — immutability
    // evidence is checkable against the row, not a narrative.
    const recomputed = receiptHashOf({
      observationId: stored.observationId,
      subjectPoolId: stored.subjectPoolId,
      subjectAssetId: stored.subjectAssetId,
      eventAt: stored.eventAt,
      availableAt: stored.availableAt,
      sourceObservedAt: stored.sourceObservedAt,
      sourcePublishedAt: stored.sourcePublishedAt,
      authorizedAt: stored.authorizedAt,
      requestedAt: stored.requestedAt,
      fetchedAt: stored.fetchedAt,
      ingestedAt: stored.ingestedAt,
      finalizedAt: stored.finalizedAt,
      revisedAt: stored.revisedAt,
      availabilityProvenance: stored.availabilityProvenance,
      rawAmount: stored.rawAmount,
      decimals: stored.decimals,
      coordinatesChainId: stored.coordinatesChainId,
      blockNumberOrSlot: stored.blockNumberOrSlot,
      blockHash: stored.blockHash,
      parentBlockHashOrParentSlot: stored.parentBlockHashOrParentSlot,
      transactionHash: stored.transactionHash,
      transactionIndex: stored.transactionIndex,
      instructionIndex: stored.instructionIndex,
      innerInstructionIndex: stored.innerInstructionIndex,
      confirmationLevel: stored.confirmationLevel,
      reorgVersion: stored.reorgVersion,
      collectorOrProviderCursor: stored.collectorOrProviderCursor,
      qualityCodes: [...stored.qualityCodes],
    });
    expect(recomputed).toBe(stored.receiptHash);
  });

  it('refuses duplicate observation ids (receipt_hash is a unique content address)', async () => {
    await expect(appendObservation(engine, baseObservation('obs_r1'))).rejects.toThrow();
  });

  it('rejects mutation attempts against observations at the database boundary', async () => {
    await expect(
      engine.query("UPDATE observations SET raw_amount = '0' WHERE observation_id = $1", [
        'obs_r1',
      ]),
    ).rejects.toThrow();
    await expect(
      engine.query('DELETE FROM observations WHERE observation_id = $1', ['obs_r1']),
    ).rejects.toThrow();
  });

  it('refuses null quantities without an explicit quality code (§13.2)', async () => {
    // Same observation shape, but with the quantity fields absent entirely.
    const stripQuantity = (input: ObservationInput): ObservationInput => {
      const copy = { ...input } as Record<string, unknown>;
      delete copy.rawAmount;
      delete copy.decimals;
      return copy as unknown as ObservationInput;
    };
    const missing = stripQuantity(baseObservation('obs_null_nocode'));
    await expect(appendObservation(engine, missing)).rejects.toThrow();

    const explained: ObservationInput = {
      ...missing,
      observationId: 'obs_null_code',
      qualityCodes: ['MISSING_PROVIDER'],
    };
    const ok = await appendObservation(engine, explained);
    expect(ok.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('revision chains preserve originals byte-for-byte (T026, AC-025)', () => {
  it('appends revisions without altering the original row or its receipt hash', async () => {
    const before = await loadObservation(engine, 'obs_r1');
    if (before === null) throw new Error('setup missing');

    const first = await appendRevision(engine, {
      revisionId: 'rev_1',
      observationId: 'obs_r1',
      reason: 'PROVIDER_CORRECTION',
      availableAt: utcTimestamp('2026-01-02T00:00:00Z'),
      availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
      rawAmount: '2000000000000000000',
      decimals: 18,
    });
    expect(first.revisionNo).toBe(1);
    expect(first.supersededReceiptHash).toBe(before.receiptHash);

    const second = await appendRevision(engine, {
      revisionId: 'rev_2',
      observationId: 'obs_r1',
      reason: 'REORG_SUPERSEDING',
      availableAt: utcTimestamp('2026-01-03T00:00:00Z'),
      availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
      rawAmount: '3000000000000000000',
      decimals: 18,
    });
    expect(second.revisionNo).toBe(2);
    // Both revisions supersede the same immutable anchor — the original's
    // receipt hash; chain order is carried by revision_no, never by mutation.
    expect(second.supersededReceiptHash).toBe(before.receiptHash);

    // The original is untouched.
    const after = await loadObservation(engine, 'obs_r1');
    expect(after).toEqual(before);
  });

  it('rejects mutation of revision rows too', async () => {
    await expect(
      engine.query('UPDATE observation_revisions SET raw_amount = NULL WHERE revision_id = $1', [
        'rev_1',
      ]),
    ).rejects.toThrow();
    await expect(
      engine.query('DELETE FROM observation_revisions WHERE revision_id = $1', ['rev_1']),
    ).rejects.toThrow();
  });

  it('refuses revisions for unknown observations and duplicate revision ids', async () => {
    await expect(
      appendRevision(engine, {
        revisionId: 'rev_ghost',
        observationId: 'obs_missing',
        reason: 'PROVIDER_CORRECTION',
        availableAt: utcTimestamp('2026-01-04T00:00:00Z'),
        availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
      }),
    ).rejects.toThrow(/unknown observation/);

    await expect(
      appendRevision(engine, {
        revisionId: 'rev_1',
        observationId: 'obs_r1',
        reason: 'PROVIDER_CORRECTION',
        availableAt: utcTimestamp('2026-01-05T00:00:00Z'),
        availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
      }),
    ).rejects.toThrow();
  });
});

describe('compensating events pin the original receipt hash (T026)', () => {
  it('records a reorg compensation referencing the superseded original', async () => {
    const before = await loadObservation(engine, 'obs_r1');
    if (before === null) throw new Error('setup missing');
    const { originalReceiptHash } = await appendCompensatingEvent(engine, {
      compensationId: 'comp_1',
      targetObservationId: 'obs_r1',
      kind: 'REORG_SUPERSEDING',
      availableAt: utcTimestamp('2026-01-06T00:00:00Z'),
    });
    expect(originalReceiptHash).toBe(before.receiptHash);
    // The original still stands; the compensation is an additional row.
    expect(await loadObservation(engine, 'obs_r1')).toEqual(before);
  });

  it('refuses compensations for unknown targets and refuses mutation', async () => {
    await expect(
      appendCompensatingEvent(engine, {
        compensationId: 'comp_ghost',
        targetObservationId: 'obs_missing',
        kind: 'FINALITY_CORRECTION',
        availableAt: utcTimestamp('2026-01-07T00:00:00Z'),
      }),
    ).rejects.toThrow(/unknown observation/);

    await expect(
      engine.query('UPDATE compensating_events SET kind = $1 WHERE compensation_id = $2', [
        'FINALITY_CORRECTION',
        'comp_1',
      ]),
    ).rejects.toThrow();
    await expect(
      engine.query('DELETE FROM compensating_events WHERE compensation_id = $1', ['comp_1']),
    ).rejects.toThrow();
  });
});
