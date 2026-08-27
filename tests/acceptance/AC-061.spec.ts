/**
 * AC-061 acceptance (positive).
 * Traces: FR-DATA-005, FR-DR-001.
 * AC text (manifest §39.7): "Provider outage returns explicit partial/
 * insufficient output and suppresses unsafe automated alerts."
 *
 * The three vocabularies this package owns render the outage explicitly:
 * acquisition states name the failure, §13.9 quality codes explain every
 * missing/impaired field, and the recovery-health vocabulary blocks
 * automated opportunity influence while deterministic risk monitoring stays
 * allowed. No surface can be read as fabricated success.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  AcquisitionState,
  degradedHealthState,
  utcTimestamp,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  appendObservation,
  fieldQualityForObservation,
  fieldsByQualityState,
  openIncident,
  recordAcquisitionDecision,
  recordFieldQuality,
  recordRecoveryHealthState,
} from '@foresift/persistence';
import { closeTestDatabase, makeTestDatabase, seedPool, type TestDatabase } from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;
let poolId: string;
const OUTAGE_OBS = 'ac061-obs-outage';

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  poolId = await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac061',
  });
  await appendObservation(engine, {
    observationId: OUTAGE_OBS,
    subjectPoolId: poolId,
    eventAt: T('2026-06-01T08:00:00Z'),
    availableAt: T('2026-06-01T08:30:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '1000',
    decimals: 2,
  });

  // Provider outage window: one usable field, one coded null (the outage
  // itself), one present-but-impaired value. Every absence is explained.
  await recordFieldQuality(engine, {
    fieldQualityId: 'ac061-fq-volume-null',
    observationId: OUTAGE_OBS,
    fieldPath: 'metrics.volumeUsd24h',
    valueRaw: null,
    qualityCodes: ['MISSING_PROVIDER', 'PARTIAL'],
  });
  await recordFieldQuality(engine, {
    fieldQualityId: 'ac061-fq-price-stale',
    observationId: OUTAGE_OBS,
    fieldPath: 'metrics.priceUsd',
    valueRaw: '0.731',
    qualityCodes: ['STALE'],
  });
  await recordFieldQuality(engine, {
    fieldQualityId: 'ac061-fq-block-ok',
    observationId: OUTAGE_OBS,
    fieldPath: 'context.blockHeight',
    valueRaw: '19984572',
    qualityCodes: ['VALID'],
  });

  // The acquisition attempt during the outage terminates in an explicit
  // provider-unavailable state — recorded, never rewritten into success.
  await recordAcquisitionDecision(tdb.engine, {
    decisionId: 'ac061-outage-decision',
    candidateId: 'cand/ac061',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.PROVIDER_UNAVAILABLE,
    requestedAt: T('2026-06-01T08:05:00Z'),
  });

  // Degradation vocabulary: automated opportunity influence suppressed for
  // the affected capability; deterministic risk monitoring stays allowed.
  // Health states reference a real incident (recovery_health_states_incident_fk):
  // the outage window pushed the observations tier past its recovery objective,
  // so the durable incident is opened first and the state anchors to it.
  await openIncident(tdb.engine, {
    incidentId: 'incident-ac061-outage',
    kind: 'RTO_MISSED',
    reason: 'provider outage window: observations recovery exceeded its RTO objective',
    openedAt: T('2026-06-01T08:10:00Z'),
  });
  await recordRecoveryHealthState(tdb.engine, {
    healthStateId: 'ac061-health-outage',
    state: degradedHealthState(
      'observations',
      'incident-ac061-outage',
      T('2026-06-01T08:10:00Z'),
      'provider outage window: explicit partial output only; unsafe automated alerts suppressed',
    ),
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-061: vocabularies render explicit partial/insufficient output', () => {
  it('the outage acquisition renders exactly PROVIDER_UNAVAILABLE — never a success shape', async () => {
    const rows = await tdb.engine.query<{
      state: string;
      completed_at: string | null;
      evidence_family: string;
    }>(
      `SELECT state, completed_at, evidence_family FROM evidence_acquisition_decisions
       WHERE decision_id = 'ac061-outage-decision'`,
    );
    const d = rows.rows[0];
    expect(d?.state).toBe(AcquisitionState.PROVIDER_UNAVAILABLE);
    expect(d?.completed_at).toBeNull(); // no retrieval completed — nothing to claim
    expect(d?.state === AcquisitionState.RETURNED).toBe(false);
  });

  it('the quality vocabulary renders the impaired window as CODED_NULL/CODED_VALUE/USABLE', async () => {
    const stored = await fieldQualityForObservation(tdb.engine, OUTAGE_OBS);
    const byPath = new Map(stored.map((f) => [f.fieldPath, f]));
    // The outage-missing volume is a CODED_NULL explaining WHY it is absent…
    const volume = byPath.get('metrics.volumeUsd24h');
    expect(volume?.qualityCodes).toContain('MISSING_PROVIDER');
    // …the stale price is present but impaired…
    expect(byPath.get('metrics.priceUsd')?.qualityCodes).toEqual(['STALE']);
    // …and the healthy field is plainly usable.
    expect(byPath.get('context.blockHeight')?.qualityCodes).toEqual(['VALID']);

    // State query API partitions the same rows identically.
    const usable = await fieldsByQualityState(tdb.engine, {
      state: 'USABLE',
      observationIds: [OUTAGE_OBS],
    });
    expect(usable.map((f) => f.fieldPath)).toEqual(['context.blockHeight']);
    const codedNulls = await fieldsByQualityState(tdb.engine, {
      state: 'CODED_NULL',
      observationIds: [OUTAGE_OBS],
    });
    expect(codedNulls.map((f) => f.fieldPath)).toEqual(['metrics.volumeUsd24h']);
  });

  it('no blanket-success rendering is possible from the stored vocabularies', async () => {
    // Only one of three fields is VALID-coded; the acquisition never returned;
    // a consumer composing "success" from these surfaces cannot.
    const validOnly = await fieldsByQualityState(tdb.engine, {
      code: 'VALID',
      observationIds: [OUTAGE_OBS],
    });
    expect(validOnly).toHaveLength(1);
    expect(validOnly[0]?.fieldPath).toBe('context.blockHeight');
  });

  it('the degradation vocabulary suppresses opportunity influence and preserves risk monitoring', async () => {
    const rows = await tdb.engine.query<{
      kind: string;
      confirmed_opportunity_influence_blocked: boolean;
      deterministic_risk_monitoring_allowed: boolean;
      incident_id: string | null;
    }>(
      `SELECT kind, confirmed_opportunity_influence_blocked,
              deterministic_risk_monitoring_allowed, incident_id
       FROM recovery_health_states WHERE health_state_id = 'ac061-health-outage'`,
    );
    const h = rows.rows[0];
    expect(h?.kind).toBe('DEGRADED');
    expect(h?.confirmed_opportunity_influence_blocked).toBe(true);
    expect(h?.deterministic_risk_monitoring_allowed).toBe(true);
    expect(h?.incident_id).toBe('incident-ac061-outage');
  });
});
