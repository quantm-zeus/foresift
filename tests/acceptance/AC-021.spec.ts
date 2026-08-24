/**
 * AC-021 acceptance (positive).
 * Traces: FR-DATA-002 (immutable observations and revisions), §13.4.
 * AC text (manifest §39): "Revisions/reorgs do not erase original
 * observations."
 *
 * Provider corrections create NEW revision rows; reorg/finality corrections
 * create compensating events; the original receipt survives byte-for-byte in
 * every case, verifiable through its content-addressed receipt hash.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  appendCompensatingEvent,
  appendObservation,
  appendRevision,
  currentObservations,
  loadObservation,
  replayObservations,
} from '@foresift/persistence';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  await appendObservation(tdb.engine, {
    observationId: 'ac21-orig',
    eventAt: T('2026-06-02T09:00:00Z'),
    availableAt: T('2026-06-02T09:05:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '1000',
    decimals: 2,
    coordinates: {
      chainId: 'eip155:1',
      blockNumberOrSlot: '20000000',
      confirmationLevel: 'FINALIZED',
    },
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-021: revisions/reorgs preserve original observations', () => {
  it('a provider correction adds a revision row and leaves the original untouched', async () => {
    const before = await loadObservation(tdb.engine, 'ac21-orig');
    expect(before).not.toBeNull();

    const rev = await appendRevision(tdb.engine, {
      revisionId: 'ac21-rev1',
      observationId: 'ac21-orig',
      reason: 'PROVIDER_CORRECTION',
      availableAt: T('2026-06-02T11:00:00Z'),
      availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
      rawAmount: '1100',
      decimals: 2,
    });
    expect(rev.revisionNo).toBe(1);
    // The superseded hash anchors the correction to the ORIGINAL receipt.
    expect(rev.supersededReceiptHash).toBe(before?.receiptHash);

    const after = await loadObservation(tdb.engine, 'ac21-orig');
    expect(after).toEqual(before);
  });

  it('a reorg creates a compensating event without rewriting the original', async () => {
    const before = await loadObservation(tdb.engine, 'ac21-orig');

    const comp = await appendCompensatingEvent(tdb.engine, {
      compensationId: 'ac21-comp1',
      targetObservationId: 'ac21-orig',
      kind: 'REORG_SUPERSEDING',
      availableAt: T('2026-06-02T12:00:00Z'),
    });
    expect(comp.originalReceiptHash).toBe(before?.receiptHash);

    const after = await loadObservation(tdb.engine, 'ac21-orig');
    expect(after).toEqual(before); // byte-for-byte survival
  });

  it('the original receipt hash remains its content address across all corrections', async () => {
    const stored = await loadObservation(tdb.engine, 'ac21-orig');
    expect(stored).not.toBeNull();
    // Recompute the hash from the stored projection itself.
    const { receiptHashOf } = await import('@foresift/persistence');
    const recomputed = receiptHashOf({
      observationId: stored!.observationId,
      subjectPoolId: stored!.subjectPoolId,
      subjectAssetId: stored!.subjectAssetId,
      eventAt: stored!.eventAt,
      availableAt: stored!.availableAt,
      sourceObservedAt: stored!.sourceObservedAt,
      sourcePublishedAt: stored!.sourcePublishedAt,
      authorizedAt: stored!.authorizedAt,
      requestedAt: stored!.requestedAt,
      fetchedAt: stored!.fetchedAt,
      ingestedAt: stored!.ingestedAt,
      finalizedAt: stored!.finalizedAt,
      revisedAt: stored!.revisedAt,
      availabilityProvenance: stored!.availabilityProvenance,
      rawAmount: stored!.rawAmount,
      decimals: stored!.decimals,
      coordinatesChainId: stored!.coordinatesChainId,
      blockNumberOrSlot: stored!.blockNumberOrSlot,
      blockHash: stored!.blockHash,
      parentBlockHashOrParentSlot: stored!.parentBlockHashOrParentSlot,
      transactionHash: stored!.transactionHash,
      transactionIndex: stored!.transactionIndex,
      instructionIndex: stored!.instructionIndex,
      innerInstructionIndex: stored!.innerInstructionIndex,
      confirmationLevel: stored!.confirmationLevel,
      reorgVersion: stored!.reorgVersion,
      collectorOrProviderCursor: stored!.collectorOrProviderCursor,
      qualityCodes: [...stored!.qualityCodes],
    });
    expect(recomputed).toBe(stored!.receiptHash);
  });

  it('current view resolves the latest revision; replay view resolves by boundary', async () => {
    await appendRevision(tdb.engine, {
      revisionId: 'ac21-rev2',
      observationId: 'ac21-orig',
      reason: 'PROVIDER_CORRECTION',
      availableAt: T('2026-06-02T15:00:00Z'),
      availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
      rawAmount: '1200',
      decimals: 2,
    });

    const current = await currentObservations(tdb.engine);
    const cur = current.find((r) => r.observationId === 'ac21-orig');
    expect(cur?.revisionNo).toBe(2);
    expect(cur?.rawAmount).toBe('1200');

    const early = await replayObservations(tdb.engine, T('2026-06-02T10:00:00Z'));
    const earlyRow = early.find((r) => r.observationId === 'ac21-orig');
    expect(earlyRow?.revisionNo).toBe(0);
    expect(earlyRow?.rawAmount).toBe('1000'); // the original value at that time

    const mid = await replayObservations(tdb.engine, T('2026-06-02T14:00:00Z'));
    const midRow = mid.find((r) => r.observationId === 'ac21-orig');
    expect(midRow?.revisionNo).toBe(1);
    expect(midRow?.rawAmount).toBe('1100');
  });
});
