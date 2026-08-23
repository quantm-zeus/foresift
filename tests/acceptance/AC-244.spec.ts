/**
 * AC-244 acceptance (positive) — task T055.
 * Traces: FR-DATA-004 (feature provenance, §14.3/§14.4 parity).
 * AC text (manifest §39, abridged): "A feature learned only from selectively
 * deep-researched candidates cannot claim full-universe lift…"
 *
 * Substrate owned here: every stored feature value carries feature version,
 * computation code version, event time, and population/lineage provenance;
 * the substrate-level claim check admits only FULL_UNIVERSE values with real
 * lineage as full-universe claim support.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FeatureStoreClass,
  supportsPopulationClaim,
  utcTimestamp,
  type FeatureValue,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  appendObservation,
  checkOnlineOfflineParity,
  recomputeOfflineRollingVolume,
  registerFeatureDefinition,
  writeOnlineRollingVolume,
} from '@foresift/persistence';
import { closeTestDatabase, makeTestDatabase, seedPool, type TestDatabase } from './helpers';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;
let poolId: string;

/** Map one stored feature_values row (by full coordinates) onto the domain shape. */
async function loadDomainFeatureValue(
  definitionId: string,
  storeClass: string,
  subjectKey: string,
  eventAt: UtcTimestamp,
): Promise<FeatureValue> {
  const rows = await tdb.engine.query<{
    definition_id: string;
    feature_version: number;
    computation_code_version: string;
    subject_key: string;
    event_at: Date | string;
    decimal_string: string | null;
    scale: number | null;
    quality_codes: string[];
    population_kind: FeatureValue['populationProvenance']['populationKind'];
    lineage_refs: string[];
    store_class: string;
  }>(
    `SELECT definition_id, feature_version, computation_code_version, subject_key,
            event_at, decimal_string, scale, quality_codes, population_kind,
            lineage_refs, store_class
     FROM feature_values
     WHERE definition_id = $1 AND store_class = $2 AND subject_key = $3 AND event_at = $4`,
    [definitionId, storeClass, subjectKey, eventAt],
  );
  const r = rows.rows[0];
  if (r === undefined) throw new Error(`no ${storeClass} feature value stored at ${eventAt}`);
  return {
    definitionId: r.definition_id,
    featureVersion: Number(r.feature_version),
    computationCodeVersion: r.computation_code_version,
    subjectKey: r.subject_key,
    eventAt: utcTimestamp(
      (typeof r.event_at === 'string' ? r.event_at : r.event_at.toISOString()).replace(
        '.000Z',
        'Z',
      ),
    ),
    ...(r.decimal_string === null
      ? {}
      : { value: { decimalString: r.decimal_string, scale: Number(r.scale) } }),
    qualityCodes: r.quality_codes,
    populationProvenance: { populationKind: r.population_kind, lineageRefs: r.lineage_refs },
    storeClass: r.store_class === 'ONLINE' ? FeatureStoreClass.ONLINE : FeatureStoreClass.OFFLINE,
  };
}

const WINDOW_END = T('2026-06-15T12:00:00Z');

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  poolId = await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac244',
  });
  await appendObservation(engine, {
    observationId: 'ac244-a',
    subjectPoolId: poolId,
    eventAt: T('2026-06-15T08:00:00Z'),
    availableAt: T('2026-06-15T08:05:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '1000',
    decimals: 2,
  });
  await appendObservation(engine, {
    observationId: 'ac244-b',
    subjectPoolId: poolId,
    eventAt: T('2026-06-15T09:00:00Z'),
    availableAt: T('2026-06-15T09:05:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '2500',
    decimals: 2,
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-244: feature provenance fields are present and enforced', () => {
  it('stores online and offline values with complete provenance', async () => {
    await registerFeatureDefinition(tdb.engine, { definitionId: 'def/ac244' });
    const request = {
      definitionId: 'def/ac244',
      subjectKey: poolId,
      windowStartInclusive: T('2026-06-15T00:00:00Z'),
      windowEndInclusive: WINDOW_END,
      resolvedAt: T('2026-06-15T13:00:00Z'),
      populationKind: 'FULL_UNIVERSE' as const,
    };
    const online = await writeOnlineRollingVolume(tdb.engine, request);
    const offline = await recomputeOfflineRollingVolume(tdb.engine, request);
    // Same shared computation → identical exact sums (structural parity).
    expect(offline).toEqual(online);
    expect(online.decimalString).toBe('3500');

    for (const storeClass of ['ONLINE', 'OFFLINE']) {
      const row = await tdb.engine.query<{
        feature_version: number | null;
        computation_code_version: string | null;
        event_at: Date | string | null;
        population_kind: string | null;
        lineage_refs: string[] | null;
      }>(
        'SELECT feature_version, computation_code_version, event_at, population_kind, lineage_refs FROM feature_values WHERE definition_id = $1 AND store_class = $2 AND event_at = $3',
        ['def/ac244', storeClass, WINDOW_END],
      );
      const r = row.rows[0];
      expect(r?.feature_version, `${storeClass} feature version`).toBe(1);
      expect(r?.computation_code_version, `${storeClass} code version`).toBe('rolling-volume/v1');
      expect(r?.event_at !== null && r?.event_at !== undefined, `${storeClass} event time`).toBe(
        true,
      );
      expect(r?.population_kind, `${storeClass} population`).toBe('FULL_UNIVERSE');
      expect(r?.lineage_refs?.length ?? 0, `${storeClass} lineage refs`).toBeGreaterThan(0);
    }
  });

  it('online/offline parity holds exactly at the stored-value level', async () => {
    const parity = await checkOnlineOfflineParity(tdb.engine, {
      definitionId: 'def/ac244',
      subjectKey: poolId,
      windowEndInclusive: WINDOW_END,
    });
    expect(parity.withinTolerance).toBe(true);
    expect(parity.divergence).toBe(0n);
    expect(parity.online).toBe(parity.offline);
  });

  it('a FULL_UNIVERSE value with lineage supports a full-universe claim', async () => {
    const value = await loadDomainFeatureValue(
      'def/ac244',
      'ONLINE',
      poolId,
      WINDOW_END,
    );
    expect(value.populationProvenance.populationKind).toBe('FULL_UNIVERSE');
    expect(supportsPopulationClaim(value)).toBe(true);
  });

  it('a DEEP_RESEARCH_SELECTED value is refused as full-universe claim support', async () => {
    const selectedEnd = T('2026-06-16T00:00:00Z');
    await writeOnlineRollingVolume(tdb.engine, {
      definitionId: 'def/ac244',
      subjectKey: poolId,
      windowStartInclusive: T('2026-06-15T12:00:01Z'),
      windowEndInclusive: selectedEnd,
      resolvedAt: T('2026-06-16T01:00:00Z'),
      populationKind: 'DEEP_RESEARCH_SELECTED',
    });
    const domainValue = await loadDomainFeatureValue(
      'def/ac244',
      'ONLINE',
      poolId,
      selectedEnd,
    );
    expect(domainValue.populationProvenance.populationKind).toBe('DEEP_RESEARCH_SELECTED');
    // The substrate refuses this record as a full-universe claim support —
    // the lift-claim logic itself belongs to later evaluation packages.
    expect(supportsPopulationClaim(domainValue)).toBe(false);
  });
});
