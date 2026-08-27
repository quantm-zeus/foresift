/**
 * Online/offline feature parity (FR-DATA-004, §14.3/§14.4,
 * AC-244): batch recomputation over identical inputs yields IDENTICAL values
 * (declared tolerance: exactly zero) because both paths call THE shared
 * computation module; a genuine divergence fails loudly with the diff, not a
 * silent tolerance.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  chainIdentity,
  ErrorCode,
  ForesiftError,
  utcTimestamp,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  appendObservation,
  applyMigrations,
  checkOnlineOfflineParity,
  createEngine,
  ensureChain,
  insertDex,
  insertPool,
  PARITY_TOLERANCE,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recomputeOfflineRollingVolume,
  registerFeatureDefinition,
  ROLLING_VOLUME_DEFINITION,
  type DatabaseEngine,
  type ObservationInput,
  writeOnlineRollingVolume,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);
const SUBJECT = 'eip155:1/uniswap/0x00000000000000000000000000000000c0ffee01';
const DEFINITION = 'fd:rolling-volume:g0';

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
  await registerFeatureDefinition(engine, { definitionId: DEFINITION });

  // Timeline: three timely events plus one late-arriving backfilled event.
  const events: Array<{
    id: string;
    eventAt: string;
    availableAt: string;
    rawAmount?: string;
  }> = [
    {
      id: 'obs_fv_a',
      eventAt: '2026-01-05T10:00:00Z',
      availableAt: '2026-01-05T10:00:05Z',
      rawAmount: '100',
    },
    {
      id: 'obs_fv_b',
      eventAt: '2026-01-05T10:30:00Z',
      availableAt: '2026-01-05T10:30:05Z',
      rawAmount: '250',
    },
    {
      id: 'obs_fv_c',
      eventAt: '2026-01-05T11:00:00Z',
      availableAt: '2026-01-05T11:00:05Z',
      rawAmount: '40',
    },
    {
      id: 'obs_fv_d',
      eventAt: '2026-01-05T10:45:00Z',
      availableAt: '2026-01-05T12:00:00Z',
      rawAmount: '999',
    },
  ];
  for (const e of events) {
    await appendObservation(engine, {
      ...baseObservation(e.id),
      eventAt: utcTimestamp(e.eventAt),
      availableAt: utcTimestamp(e.availableAt),
      ...(e.rawAmount === undefined ? {} : { rawAmount: e.rawAmount }),
    });
  }
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

function baseObservation(observationId: string): ObservationInput {
  return {
    observationId,
    subjectPoolId: SUBJECT,
    eventAt: utcTimestamp('2026-01-05T10:00:00Z'),
    availableAt: utcTimestamp('2026-01-05T10:00:05Z'),
    sourceObservedAt: utcTimestamp('2026-01-05T09:59:58Z'),
    fetchedAt: utcTimestamp('2026-01-05T10:00:04Z'),
    ingestedAt: utcTimestamp('2026-01-05T10:00:05Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '1000000000000000000',
    decimals: 18,
    qualityCodes: [],
    coordinates: {
      chainId: 'eip155:1',
      blockNumberOrSlot: '19000200',
      blockHash: '0x' + 'ab'.repeat(32),
      transactionHash: '0x' + 'ef'.repeat(32),
      transactionIndex: 11,
      confirmationLevel: 'FINALIZED',
    },
  };
}

const WINDOW = (): { start: UtcTimestamp; end: UtcTimestamp } => ({
  start: utcTimestamp('2026-01-05T10:00:00Z'),
  end: utcTimestamp('2026-01-05T11:00:00Z'),
});

describe('shared-module rolling volume', () => {
  it('excludes events whose availability exceeds the replay boundary', async () => {
    // Resolved at 11:30, the late event (available 12:00) is NOT yet visible:
    // exact sum 100+250+40 = 390.
    const w = WINDOW();
    const result = await writeOnlineRollingVolume(engine, {
      definitionId: DEFINITION,
      subjectKey: SUBJECT,
      windowStartInclusive: w.start,
      windowEndInclusive: w.end,
      resolvedAt: utcTimestamp('2026-01-05T11:30:00Z'),
      populationKind: 'FULL_UNIVERSE',
    });
    expect(result.decimalString).toBe('390');
    expect([...result.qualityCodes]).toEqual(['VALID']);
  });

  it('yields LOW_SAMPLE null over an empty window', async () => {
    const result = await writeOnlineRollingVolume(engine, {
      definitionId: DEFINITION,
      subjectKey: SUBJECT,
      windowStartInclusive: utcTimestamp('2026-02-01T00:00:00Z'),
      windowEndInclusive: utcTimestamp('2026-02-01T01:00:00Z'),
      resolvedAt: utcTimestamp('2026-02-01T12:00:00Z'),
      populationKind: 'FULL_UNIVERSE',
    });
    expect(result.decimalString).toBeNull();
    expect(result.qualityCodes).toContain('LOW_SAMPLE');
  });

  it('flags PARTIAL when unquantified events share the window', async () => {
    const partial = {
      ...baseObservation('obs_fv_partial'),
      eventAt: utcTimestamp('2026-01-05T10:15:00Z'),
      availableAt: utcTimestamp('2026-01-05T10:15:05Z'),
      // An unquantified observation: no quantity pair, explained by a code.
      qualityCodes: ['MISSING_PROVIDER'],
    };
    const stripped = { ...partial } as Record<string, unknown>;
    delete stripped.rawAmount;
    delete stripped.decimals;
    await appendObservation(engine, stripped as unknown as ObservationInput);

    const w = WINDOW();
    const result = await writeOnlineRollingVolume(engine, {
      definitionId: DEFINITION,
      subjectKey: SUBJECT,
      windowStartInclusive: w.start,
      windowEndInclusive: w.end,
      resolvedAt: utcTimestamp('2026-01-05T11:30:00Z'),
      populationKind: 'FULL_UNIVERSE',
    });
    // The unquantified event contributes nothing to the exact sum…
    expect(result.decimalString).toBe('390');
    // …but the value is honestly flagged PARTIAL, never silently complete.
    expect([...result.qualityCodes]).toEqual(['PARTIAL']);
  });
});

describe('online/offline parity (AC-244)', () => {
  it('recomputation over identical inputs yields byte-identical values at tolerance zero', async () => {
    const w = WINDOW();
    const request = {
      definitionId: DEFINITION,
      subjectKey: SUBJECT,
      windowStartInclusive: w.start,
      windowEndInclusive: w.end,
      resolvedAt: utcTimestamp('2026-01-05T11:30:00Z'),
      populationKind: 'FULL_UNIVERSE' as const,
    };
    // Idempotent rewrite on both stores, then compare.
    await writeOnlineRollingVolume(engine, request);
    await recomputeOfflineRollingVolume(engine, request);
    const parity = await checkOnlineOfflineParity(engine, {
      definitionId: DEFINITION,
      subjectKey: SUBJECT,
      windowEndInclusive: w.end,
    });
    expect(PARITY_TOLERANCE).toBe(0n);
    expect(parity.online).toBe(parity.offline);
    expect(parity.divergence).toBe(0n);
    expect(parity.withinTolerance).toBe(true);
  });

  it('refreshes population and lineage provenance when an upsert overwrites a value', async () => {
    const w = WINDOW();
    // Distinct subject so the rewrite cannot disturb sibling parity tests
    // that share the default SUBJECT coordinates.
    const subjectKey = `${SUBJECT}#provenance-rewrite`;
    const base = {
      definitionId: DEFINITION,
      subjectKey,
      windowStartInclusive: w.start,
      windowEndInclusive: w.end,
      resolvedAt: utcTimestamp('2026-01-05T11:30:00Z'),
    };
    await writeOnlineRollingVolume(engine, { ...base, populationKind: 'FULL_UNIVERSE' });
    // Recompute the same coordinates under different provenance inputs.
    await writeOnlineRollingVolume(engine, {
      ...base,
      resolvedAt: utcTimestamp('2026-01-05T12:45:00Z'),
      populationKind: 'DEEP_RESEARCH_SELECTED',
    });
    const row = await engine.query<{
      population_kind: string;
      lineage_refs: string[];
      decimal_string: string | null;
    }>(
      `SELECT population_kind, lineage_refs, decimal_string FROM feature_values
       WHERE definition_id = $1 AND store_class = 'ONLINE' AND subject_key = $2 AND event_at = $3`,
      [DEFINITION, subjectKey, w.end],
    );
    const stored = row.rows[0];
    expect(stored?.population_kind).toBe('DEEP_RESEARCH_SELECTED');
    expect(stored?.lineage_refs.some((ref) => ref.includes('2026-01-05T12:45:00Z'))).toBe(true);
  });

  it('fails loudly with the diff when inputs genuinely diverge across the boundary', async () => {
    const w = WINDOW();
    // Online was resolved at 11:30 (sum 390). An offline batch recomputes at
    // 12:30, when the late event (999) has become visible — same coordinates,
    // DIFFERENT resolved inputs. That divergence must fail, not be absorbed.
    await recomputeOfflineRollingVolume(engine, {
      definitionId: DEFINITION,
      subjectKey: SUBJECT,
      windowStartInclusive: w.start,
      windowEndInclusive: w.end,
      resolvedAt: utcTimestamp('2026-01-05T12:30:00Z'),
      populationKind: 'FULL_UNIVERSE',
    });
    const err = await checkOnlineOfflineParity(engine, {
      definitionId: DEFINITION,
      subjectKey: SUBJECT,
      windowEndInclusive: w.end,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForesiftError);
    expect((err as ForesiftError).code).toBe(ErrorCode.FEATURE_ONLINE_OFFLINE_DIVERGENCE);
    expect(JSON.stringify((err as ForesiftError).detail)).toContain('999');
  });

  it('refuses parity when the two stores disagree on computation code version', async () => {
    const w = WINDOW();
    // Repair the offline value first so only the code version differs.
    await recomputeOfflineRollingVolume(engine, {
      definitionId: DEFINITION,
      subjectKey: SUBJECT,
      windowStartInclusive: w.start,
      windowEndInclusive: w.end,
      resolvedAt: utcTimestamp('2026-01-05T11:30:00Z'),
      populationKind: 'FULL_UNIVERSE',
    });
    await engine.query(
      `UPDATE feature_values SET computation_code_version = 'rolling-volume/v0-drifted'
       WHERE definition_id = $1 AND store_class = 'OFFLINE' AND subject_key = $2
         AND event_at = $3`,
      [DEFINITION, SUBJECT, w.end],
    );
    await expect(
      checkOnlineOfflineParity(engine, {
        definitionId: DEFINITION,
        subjectKey: SUBJECT,
        windowEndInclusive: w.end,
      }),
    ).rejects.toThrowError(ForesiftError);
  });
});

// Insert-or-verify convention for feature definitions (as for identity rows):
// an identical re-registration is a no-op; a divergent one refuses as a typed
// conflict instead of silently keeping the stored semantics.
describe('feature-definition re-registration semantics', () => {
  it('accepts an identical re-registration as a no-op', async () => {
    await expect(
      registerFeatureDefinition(engine, { definitionId: DEFINITION }),
    ).resolves.toBeUndefined();
    const rows = await engine.query<{ name: string; version: number }>(
      'SELECT name, version FROM feature_definitions WHERE definition_id = $1',
      [DEFINITION],
    );
    expect(rows.rows).toHaveLength(1);
  });

  const divergenceCases = [
    ['name', { name: 'rolling-volume-impostor' }],
    ['version', { version: 99 }],
    ['unit_semantics', { unitSemantics: 'USD_PER_SECOND' }],
  ] as const;
  for (const [column, override] of divergenceCases) {
    it(`refuses divergence in ${column} and keeps the stored definition`, async () => {
      // The probe carries its own distinct content so each attempt diverges in
      // EXACTLY one column without touching UNIQUE (name, version) — this block
      // pins the insert-or-verify convention, not that schema constraint.
      const probeId = 'fd:re-registration-probe';
      const probeContent = {
        name: 're-registration-probe',
        version: ROLLING_VOLUME_DEFINITION.version,
        unitSemantics: ROLLING_VOLUME_DEFINITION.unitSemantics,
      };
      await registerFeatureDefinition(engine, { definitionId: probeId, ...probeContent });
      await expect(
        registerFeatureDefinition(engine, { definitionId: probeId, ...probeContent, ...override }),
      ).rejects.toMatchObject({ code: ErrorCode.CONTRACT_INVARIANT_VIOLATED });
      // The stored definition survived untouched — later values keep computing
      // against the originally registered semantics.
      const rows = await engine.query<{
        name: string;
        version: number;
        unit_semantics: string;
      }>('SELECT name, version, unit_semantics FROM feature_definitions WHERE definition_id = $1', [
        probeId,
      ]);
      expect(rows.rows[0]).toEqual({
        name: probeContent.name,
        version: probeContent.version,
        unit_semantics: probeContent.unitSemantics,
      });
    });
  }
});
