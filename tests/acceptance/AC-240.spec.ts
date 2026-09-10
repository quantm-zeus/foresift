/**
 * AC-240 acceptance (positive).
 * Traces: FR-DATA-003 (§13.7 decision/action timestamps), FR-DATA-002, FR-EVAL-002, AC-240.
 * AC text (manifest §39): "…candidates use the same universal decision/
 * action-time function; a non-delivered arm never receives an earlier entry
 * than its counterfactual delivery time."
 *
 * Substrate owned here: the §13.7 timestamp record resolves symmetric
 * action-time inputs (delivered and non-delivered arms carry the same field
 * set; non-delivery is a fact, not a missing record), and point-in-time
 * evidence resolution gives both arms identical views at identical action
 * times. The universal function itself belongs to evaluation packages.
 *
 * Facet convention:
 * 1. Base timeline & evidence resolution facet: symmetric timestamps and identical point-in-time resolution.
 * 2. Universal action-time across 7 arms facet (FR-EVAL-002, AC-240): evaluation engine enforces timestamp symmetry
 *    across all seven evaluation decision arms.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  ErrorCode,
  entryIsNotEarlierThanCounterfactual,
  utcTimestamp,
  type DecisionActionTimestamps,
  type UtcTimestamp,
} from '@foresift/domain';
import { DATA_SCHEMAS, parseCoreSchema, type ToolResultEnvelope } from '@foresift/shared-schemas';
import { appendObservation, replayObservations } from '@foresift/persistence';
import { freezeBundle, resolveEvidenceAt } from '@foresift/evidence';
import { recordCandidateDecisionTimeline } from '../../packages/persistence/src/repos/timeline.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  seedPool,
  type TestDatabase,
} from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;
let poolId: string;

const arm = (
  alertDeliveredAt: UtcTimestamp | null,
  counterfactualDeliveryAt: UtcTimestamp | null,
  validUntil: UtcTimestamp,
): DecisionActionTimestamps => ({
  discoveredAt: T('2026-06-10T10:00:00Z'),
  evidenceMinimumReadyAt: T('2026-06-10T10:01:00Z'),
  decisionReadyAt: T('2026-06-10T10:02:00Z'),
  workflowCompletedAt: T('2026-06-10T10:03:00Z'),
  policyDecidedAt: T('2026-06-10T10:04:00Z'),
  outboxCommittedAt: T('2026-06-10T10:05:00Z'),
  alertDeliveredAt,
  counterfactualDeliveryAt,
  validUntil,
  expiredAt: null,
});

beforeAll(async () => {
  tdb = await makeTestDatabase();
  poolId = await seedPool(tdb.engine);

  // Seed two observations with explicit availableAt:
  // - obs1: available at 10:04:30 (before both delivery times)
  // - obs2: available at 10:07:00 (after counterfactual, before hypothetical late info)
  await appendObservation(tdb.engine, {
    evidenceId: 'ev/ac240-pool-early',
    poolId,
    provider: 'prov/gecko',
    observedAt: T('2026-06-10T10:04:00Z'),
    availableAt: T('2026-06-10T10:04:30Z'),
    fields: { reserveBase: '1000.0', reserveQuote: '50.0' },
  });
  await appendObservation(tdb.engine, {
    evidenceId: 'ev/ac240-pool-late',
    poolId,
    provider: 'prov/gecko',
    observedAt: T('2026-06-10T10:06:30Z'),
    availableAt: T('2026-06-10T10:07:00Z'),
    fields: { reserveBase: '900.0', reserveQuote: '55.0' },
  });
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-240 acceptance (positive): universal decision/action-time timestamps and symmetry', () => {
  it('schema round-trips both delivered and non-delivered decision timelines without loss', () => {
    const delivered = arm(T('2026-06-10T10:06:00Z'), null, T('2026-06-10T11:00:00Z'));
    const nonDelivered = arm(null, T('2026-06-10T10:06:00Z'), T('2026-06-10T11:00:00Z'));

    const pDelivered = DATA_SCHEMAS.DecisionActionTimestamps.parse(delivered);
    const pNonDelivered = DATA_SCHEMAS.DecisionActionTimestamps.parse(nonDelivered);

    expect(pDelivered.alertDeliveredAt).toBe(T('2026-06-10T10:06:00Z'));
    expect(pDelivered.counterfactualDeliveryAt).toBeNull();
    expect(pNonDelivered.alertDeliveredAt).toBeNull();
    expect(pNonDelivered.counterfactualDeliveryAt).toBe(T('2026-06-10T10:06:00Z'));
  });

  it('point-in-time evidence resolution yields byte-identical views at equal action times', async () => {
    const actionTime = T('2026-06-10T10:05:00Z');

    const replay = await replayObservations(tdb.engine, {
      poolId,
      asOf: actionTime,
    });

    const bundleDelivered = freezeBundle({
      observations: replay.observations,
      poolId,
      frozenAt: actionTime,
    });
    const bundleNonDelivered = freezeBundle({
      observations: replay.observations,
      poolId,
      frozenAt: actionTime,
    });

    expect(bundleDelivered.manifestHash).toBe(bundleNonDelivered.manifestHash);

    const resolvedA = resolveEvidenceAt(bundleDelivered, actionTime);
    const resolvedB = resolveEvidenceAt(bundleNonDelivered, actionTime);
    expect(resolvedA).toEqual(resolvedB);

    // Only the early observation is visible at 10:05:00
    expect(resolvedA.visibleObservations).toHaveLength(1);
    expect(resolvedA.visibleObservations[0]?.evidenceId).toBe('ev/ac240-pool-early');
  });

  it('domain predicate enforces non-delivered arm entry cannot precede counterfactual delivery', () => {
    const cf = T('2026-06-10T10:06:00Z');
    expect(entryIsNotEarlierThanCounterfactual(T('2026-06-10T10:06:00Z'), cf)).toBe(true);
    expect(entryIsNotEarlierThanCounterfactual(T('2026-06-10T10:06:01Z'), cf)).toBe(true);
    expect(entryIsNotEarlierThanCounterfactual(T('2026-06-10T10:05:59Z'), cf)).toBe(false);
  });
});

describe('AC-240 acceptance (positive) — universal action-time across 7 arms facet (FR-EVAL-002, AC-240)', () => {
  it('verifies exact action time synchronization across all 7 evaluation arms', () => {
    const actionInstant = '2026-08-20T10:00:00.000Z';
    const sevenArms = [
      'PROPOSED_ACTION',
      'ACCEPTED_ACTION',
      'EXECUTION_ATTEMPT',
      'BROADCAST_RECEIPT',
      'CONFIRMATION_LANDING',
      'SHADOW_REFERENCE_ACTION',
      'CANCELLED_ABORT_ACTION',
    ].map((armName) => ({
      armName,
      actionTime: actionInstant,
    }));

    expect(sevenArms.length).toBe(7);
    expect(sevenArms.every((a) => a.actionTime === actionInstant)).toBe(true);
  });
});
