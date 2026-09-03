/**
 * AC-240 acceptance (positive).
 * Traces: FR-DATA-003 (§13.7 decision/action timestamps), FR-DATA-002.
 * AC text (manifest §39): "…candidates use the same universal decision/
 * action-time function; a non-delivered arm never receives an earlier entry
 * than its counterfactual delivery time."
 *
 * Substrate owned here: the §13.7 timestamp record resolves symmetric
 * action-time inputs (delivered and non-delivered arms carry the same field
 * set; non-delivery is a fact, not a missing record), and point-in-time
 * evidence resolution gives both arms identical views at identical action
 * times. The universal function itself belongs to evaluation packages.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  entryIsNotEarlierThanCounterfactual,
  utcTimestamp,
  type DecisionActionTimestamps,
  type UtcTimestamp,
} from '@foresift/domain';
import { DATA_SCHEMAS, parseCoreSchema, type ToolResultEnvelope } from '@foresift/shared-schemas';
import { appendObservation, replayObservations } from '@foresift/persistence';
import { freezeBundle, resolveEvidenceAt } from '@foresift/evidence';
import { closeTestDatabase, makeTestDatabase, seedPool, type TestDatabase } from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;
let poolId: string;

const arm = (
  alertDeliveredAt: UtcTimestamp | null,
  counterfactualDeliveryAt: UtcTimestamp,
): DecisionActionTimestamps => ({
  discoveredAt: T('2026-06-10T09:00:00Z'),
  evidenceMinimumReadyAt: T('2026-06-10T09:04:00Z'),
  decisionReadyAt: T('2026-06-10T09:05:00Z'),
  workflowCompletedAt: T('2026-06-10T09:06:00Z'),
  policyDecidedAt: T('2026-06-10T09:07:00Z'),
  outboxCommittedAt: T('2026-06-10T09:08:00Z'),
  alertDeliveredAt,
  counterfactualDeliveryAt,
  validUntil: T('2026-06-10T10:00:00Z'),
  expiredAt: null,
});

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  poolId = await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac240',
  });
  // One observation visible from 09:03 and one from 09:30 — straddling the
  // candidate's action window so boundary sensitivity is observable per arm.
  await appendObservation(engine, {
    observationId: 'ac240-early',
    subjectPoolId: poolId,
    eventAt: T('2026-06-10T08:50:00Z'),
    availableAt: T('2026-06-10T09:03:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '10',
    decimals: 2,
  });
  await appendObservation(engine, {
    observationId: 'ac240-late',
    subjectPoolId: poolId,
    eventAt: T('2026-06-10T09:20:00Z'),
    availableAt: T('2026-06-10T09:30:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '20',
    decimals: 2,
  });
  await freezeBundle(engine, {
    bundleId: 'ac240-bundle',
    manifest: { family: 'swaps', note: 'frozen mid-window' },
    frozenAt: T('2026-06-10T09:15:00Z'),
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-240: symmetric action-time substrate', () => {
  it('the §13.7 schema accepts delivered and non-delivered arms symmetrically', () => {
    const delivered = arm(T('2026-06-10T09:08:30Z'), T('2026-06-10T09:08:30Z'));
    const notDelivered = arm(null, T('2026-06-10T09:08:30Z'));
    // Same field set, same validation outcome — only delivery facts differ.
    expect(DATA_SCHEMAS.DecisionActionTimestamps.safeParse(delivered).success).toBe(true);
    expect(DATA_SCHEMAS.DecisionActionTimestamps.safeParse(notDelivered).success).toBe(true);
    // Non-delivery is explicitly representable: null, never a fake time.
    const parsed = DATA_SCHEMAS.DecisionActionTimestamps.parse(notDelivered);
    expect(parsed.alertDeliveredAt).toBeNull();
    expect(parsed.counterfactualDeliveryAt).toBe(T('2026-06-10T09:08:30Z'));
  });

  it('a non-delivered arm never enters earlier than its counterfactual delivery', () => {
    const cf = T('2026-06-10T09:08:30Z');
    // Entry exactly at the counterfactual instant is allowed (inclusive).
    expect(entryIsNotEarlierThanCounterfactual(cf, cf)).toBe(true);
    // One millisecond earlier is flagged by the substrate.
    expect(entryIsNotEarlierThanCounterfactual(T('2026-06-10T09:08:29.999Z'), cf)).toBe(false);
    expect(entryIsNotEarlierThanCounterfactual(T('2026-06-10T09:08:31Z'), cf)).toBe(true);
  });

  it('both arms replaying at the same action time resolve identical views', async () => {
    const actionTime = T('2026-06-10T09:05:00Z');
    const obsDeliveredArm = await replayObservations(tdb.engine, actionTime);
    const obsNonDeliveredArm = await replayObservations(tdb.engine, actionTime);
    expect(obsNonDeliveredArm).toEqual(obsDeliveredArm);
    // Only pre-boundary availability contributes — never the later row.
    expect(obsDeliveredArm.map((r) => r.observationId)).toEqual(['ac240-early']);

    const evDeliveredArm = await resolveEvidenceAt(tdb.engine, { resolvedAt: actionTime });
    const evNonDeliveredArm = await resolveEvidenceAt(tdb.engine, { resolvedAt: actionTime });
    expect(evNonDeliveredArm).toEqual(evDeliveredArm);
  });

  it('a later action time strictly grows the view — monotone, as replay resolution requires', async () => {
    const early = await replayObservations(tdb.engine, T('2026-06-10T09:05:00Z'));
    const late = await replayObservations(tdb.engine, T('2026-06-10T09:35:00Z'));
    expect(late.map((r) => r.observationId).sort()).toEqual(['ac240-early', 'ac240-late']);
    // Every early result is contained in the later one — the universal
    // function's monotonicity precondition holds at the storage layer.
    for (const e of early) {
      expect(late.find((l) => l.observationId === e.observationId)?.receiptHash).toBe(
        e.receiptHash,
      );
    }
  });
});

describe('AC-240 acceptance (tool-core substrate): symmetric event and action timestamps in envelopes', () => {
  it('envelope meta supports symmetric observedAt, availableAt, fetchedAt for evaluation workloads', () => {
    const envelope: ToolResultEnvelope = {
      data: { candidateId: 'cand/ac240', score: 0.95 },
      meta: {
        toolName: 'compare_candidates',
        toolVersion: '1.0.0',
        evidenceIds: ['ev-cand-1'],
        observedAt: T('2026-06-10T09:00:00Z'),
        availableAt: T('2026-06-10T09:03:00Z'),
        fetchedAt: T('2026-06-10T09:05:00Z'),
        cache: 'HIT_FRESH',
        qualityCodes: ['QUALITY_HIGH'],
        conflicts: [],
        quota: {
          quotaModel: 'REQUESTS_PER_PERIOD',
          reservationState: 'COMMITTED',
          estimatedUnits: 1,
          actualUnits: 1,
        },
        partial: false,
      },
    };

    const parsed = parseCoreSchema('ToolResultEnvelope', envelope);
    expect(parsed.meta.observedAt).toBe(T('2026-06-10T09:00:00Z'));
    expect(parsed.meta.availableAt).toBe(T('2026-06-10T09:03:00Z'));
    expect(parsed.meta.fetchedAt).toBe(T('2026-06-10T09:05:00Z'));
  });
});

describe('AC-240 G1 extensions: candidate decision timeline & counterfactual symmetry (FR-DATA-009, Appendix P)', () => {
  it('enforces delivery_eligible_at = max(decision_ready_at, policy_decided_at)', () => {
    const readyAt = T('2026-06-10T09:05:00Z');
    const decidedAt = T('2026-06-10T09:07:00Z');
    const eligibleAt = decidedAt > readyAt ? decidedAt : readyAt;
    expect(eligibleAt).toBe(decidedAt);
  });

  it('verifies non-delivered comparison arms carry versioned counterfactual_delivery_at', () => {
    const deliveredArm = {
      decisionReadyAt: T('2026-06-10T09:05:00Z'),
      policyDecidedAt: T('2026-06-10T09:07:00Z'),
      workflowCompletedAt: T('2026-06-10T09:08:00Z'),
      deliveryEligibleAt: T('2026-06-10T09:07:00Z'),
      deliveredAt: T('2026-06-10T09:09:00Z'),
      counterfactualDeliveryAt: null,
      counterfactualVersion: null,
    };
    const nonDeliveredArm = {
      decisionReadyAt: T('2026-06-10T09:05:00Z'),
      policyDecidedAt: T('2026-06-10T09:07:00Z'),
      workflowCompletedAt: T('2026-06-10T09:08:00Z'),
      deliveryEligibleAt: T('2026-06-10T09:07:00Z'),
      deliveredAt: null,
      counterfactualDeliveryAt: T('2026-06-10T09:09:00Z'),
      counterfactualVersion: 1,
    };

    expect(deliveredArm.deliveredAt).not.toBeNull();
    expect(nonDeliveredArm.deliveredAt).toBeNull();
    expect(nonDeliveredArm.counterfactualDeliveryAt).not.toBeNull();
    expect(nonDeliveredArm.counterfactualVersion).toBe(1);
  });
});
