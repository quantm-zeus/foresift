/**
 * Replay resolution (FR-DATA-003, FR-DATA-002, AC-020): every replay entrypoint
 * takes an explicit boundary T; rows are admitted inclusively by the shared
 * availability predicate; the winner per observation is the latest revision
 * available at T (base = revision 0), deterministically tie-broken.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  appendRevision,
  applyMigrations,
  createEngine,
  currentObservations,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  replayObservations,
  type DatabaseEngine,
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

  // Timeline:
  //   base_a: available 10:00, revised at 14:00 (rev1) and 16:00 (rev2)
  //   base_b: available 12:00, never revised
  //   base_c: available 18:00 — after every boundary used below
  await appendObservation(engine, {
    observationId: 'replay_a',
    eventAt: utcTimestamp('2026-05-01T09:00:00Z'),
    availableAt: utcTimestamp('2026-05-01T10:00:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '100',
    decimals: 2,
  });
  await appendRevision(engine, {
    revisionId: 'replay_a_rev1',
    observationId: 'replay_a',
    reason: 'PROVIDER_CORRECTION',
    availableAt: utcTimestamp('2026-05-01T14:00:00Z'),
    availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
    rawAmount: '140',
    decimals: 2,
  });
  await appendRevision(engine, {
    revisionId: 'replay_a_rev2',
    observationId: 'replay_a',
    reason: 'PROVIDER_CORRECTION',
    availableAt: utcTimestamp('2026-05-01T16:00:00Z'),
    availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
    rawAmount: '160',
    decimals: 2,
  });
  await appendObservation(engine, {
    observationId: 'replay_b',
    eventAt: utcTimestamp('2026-05-01T11:00:00Z'),
    availableAt: utcTimestamp('2026-05-01T12:00:00Z'),
    availabilityProvenance: 'FIRST_PARTY_LIVE_OBSERVED',
    rawAmount: '200',
    decimals: 2,
  });
  await appendObservation(engine, {
    observationId: 'replay_c',
    eventAt: utcTimestamp('2026-05-01T17:00:00Z'),
    availableAt: utcTimestamp('2026-05-01T18:00:00Z'),
    availabilityProvenance: 'MANUAL_IMPORT_AVAILABLE',
    rawAmount: '300',
    decimals: 2,
  });
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

const T = (s: string): UtcTimestamp => utcTimestamp(s);

describe('replayObservations honors the inclusive availability boundary', () => {
  it('admits a row exactly at T and excludes anything after it', async () => {
    const atNoon = await replayObservations(engine, T('2026-05-01T12:00:00Z'));
    expect(atNoon.map((r) => r.observationId)).toEqual(['replay_a', 'replay_b']);
    // Exactly at T counts as visible.
    const tTen = await replayObservations(engine, T('2026-05-01T10:00:00Z'));
    expect(tTen.map((r) => r.observationId)).toEqual(['replay_a']);

    const tBefore = await replayObservations(engine, T('2026-05-01T09:59:59Z'));
    expect(tBefore).toHaveLength(0);
  });

  it('resolves the latest revision available AT T, not the global head', async () => {
    // At 15:00 only rev1 is available; rev2 lands at 16:00.
    const at1500 = await replayObservations(engine, T('2026-05-01T15:00:00Z'));
    const a = at1500.find((r) => r.observationId === 'replay_a');
    expect(a?.revisionNo).toBe(1);
    expect(a?.rawAmount).toBe('140');

    // At 17:00 rev2 is the winner.
    const at1700 = await replayObservations(engine, T('2026-05-01T17:00:00Z'));
    const a2 = at1700.find((r) => r.observationId === 'replay_a');
    expect(a2?.revisionNo).toBe(2);
    expect(a2?.rawAmount).toBe('160');

    // At 11:00 the unrevised base stands (revision 0).
    const at1100 = await replayObservations(engine, T('2026-05-01T11:00:00Z'));
    const a0 = at1100.find((r) => r.observationId === 'replay_a');
    expect(a0?.revisionNo).toBe(0);
    expect(a0?.rawAmount).toBe('100');
  });

  it('never admits future revisions into historical boundaries', async () => {
    const at1300 = await replayObservations(engine, T('2026-05-01T13:00:00Z'));
    for (const row of at1300) {
      expect(row.availableAt <= '2026-05-01T13:00:00Z').toBe(true);
    }
    expect(at1300.find((r) => r.observationId === 'replay_a')?.revisionNo).toBe(0);
  });

  it('supports subject filters without weakening the boundary', async () => {
    const poolId = 'eip155:1/uniswap/0x00000000000000000000000000000000c0ffee01';
    // No observations in this suite carry that pool id…
    const byPool = await replayObservations(engine, T('2026-05-02T00:00:00Z'), {
      subjectPoolId: poolId,
    });
    expect(byPool).toHaveLength(0);

    // …while the unfiltered full view sees all three.
    const all = await replayObservations(engine, T('2026-05-02T00:00:00Z'));
    expect(all).toHaveLength(3);
  });
});

describe('deterministic tie-break on equal availability instants', () => {
  it('prefers the higher revision when base and revision share an instant', async () => {
    await appendObservation(engine, {
      observationId: 'replay_tie_base',
      eventAt: utcTimestamp('2026-05-01T19:00:00Z'),
      availableAt: utcTimestamp('2026-05-01T20:00:00Z'),
      availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
      rawAmount: '10',
      decimals: 2,
    });
    // The correction became available AT the same instant as its base.
    await appendRevision(engine, {
      revisionId: 'replay_tie_rev',
      observationId: 'replay_tie_base',
      reason: 'PROVIDER_CORRECTION',
      availableAt: utcTimestamp('2026-05-01T20:00:00Z'),
      availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
      rawAmount: '11',
      decimals: 2,
    });
    const rows = await replayObservations(engine, T('2026-05-01T20:00:01Z'));
    const tie = rows.find((r) => r.observationId === 'replay_tie_base');
    expect(tie?.revisionNo).toBe(1);
    expect(tie?.rawAmount).toBe('11');
    expect(tie?.isRevision).toBe(true);
  });

  it('breaks revision-vs-revision ties by highest revision number', async () => {
    for (const [id, amount] of [
      ['replay_tie_rev1', '12'],
      ['replay_tie_rev2', '13'],
    ] as const) {
      await appendRevision(engine, {
        revisionId: id,
        observationId: 'replay_tie_base',
        reason: 'PROVIDER_CORRECTION',
        availableAt: utcTimestamp('2026-05-01T21:00:00Z'),
        availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
        rawAmount: amount,
        decimals: 2,
      });
    }
    const rows = await replayObservations(engine, T('2026-05-01T21:00:01Z'));
    const tie = rows.find((r) => r.observationId === 'replay_tie_base');
    // Insertion order must not matter — the comparator, not luck, decides.
    expect(tie?.revisionNo).toBe(3);
    expect(tie?.revisionId).toBe('replay_tie_rev2');
    expect(tie?.rawAmount).toBe('13');
  });
});

describe('current view differs from replay (AC-020)', () => {
  it('current resolves the global head regardless of any boundary', async () => {
    const current = await currentObservations(engine);
    const a = current.find((r) => r.observationId === 'replay_a');
    expect(a?.revisionNo).toBe(2);
    // replay_a, replay_b, replay_c, and the tie-break fixture below.
    expect(current).toHaveLength(4);
  });

  it('replay at an earlier T disagrees with current — that is the point', async () => {
    const replayed = await replayObservations(engine, T('2026-05-01T11:00:00Z'));
    const current = await currentObservations(engine);
    const ra = replayed.find((r) => r.observationId === 'replay_a');
    const ca = current.find((r) => r.observationId === 'replay_a');
    expect(ra?.revisionNo).toBe(0);
    expect(ca?.revisionNo).toBe(2);
  });

  it('every replay entrypoint takes an explicit T (compile-time contract)', async () => {
    // This suite pins the signature shape; the RUNTIME refusal of a missing/hidden
    // current-data call is exercised in tests/negative/AC-241.negative.spec.ts.
    const rows = await replayObservations(engine, T('2026-05-01T12:00:00Z'));
    expect(rows.every((r) => r.availableAt <= '2026-05-01T12:00:00Z')).toBe(true);
  });
});
