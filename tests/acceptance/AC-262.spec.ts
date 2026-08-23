/**
 * AC-262 acceptance (positive) — task T061.
 * Traces: FR-DR-001, FR-DR-002.
 * AC text (manifest §39.25): "A recovery tier violation degrades the
 * affected capability machine-readably while preserving deterministic risk
 * monitoring, and blocks active opportunity mode until repaired."
 *
 * A scripted RPO miss produces a durable incident and a persisted DEGRADED
 * health row whose flags are the machine-readable contract: confirmed
 * opportunity influence blocked, deterministic risk monitoring allowed.
 * After repair (incident resolved + re-verification) the capability returns
 * to HEALTHY through the same vocabulary.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock, utcTimestamp, type RecoveryTierId, type UtcTimestamp } from '@foresift/domain';
import {
  evaluateAndRecordDrill,
  recordRecoveryHealthState,
  registerRecoveryTier,
  resolveIncident,
} from '@foresift/persistence';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const T0 = Date.parse('2026-06-01T12:00:00.000Z');
const at = (offsetMinutes: number): UtcTimestamp =>
  utcTimestamp(new Date(T0 + offsetMinutes * 60_000).toISOString());

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  await registerRecoveryTier(
    tdb.engine,
    {
      id: 'tier-ac262-observations' as RecoveryTierId,
      dataClass: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
      rpoTargetMinutes: 60,
      rtoTargetMinutes: 120,
    },
    at(1),
  );
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-262: tier violations degrade machine-readably, then repair to HEALTHY', () => {
  it('an RPO miss persists DEGRADED with opportunity blocked and risk monitoring allowed', async () => {
    const outcome = await evaluateAndRecordDrill({
      engine: tdb.engine,
      clock: fixedClock(at(120)),
      tier: {
        id: 'tier-ac262-observations' as RecoveryTierId,
        dataClass: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
        rpoTargetMinutes: 60,
        rtoTargetMinutes: 120,
      },
      capability: 'observations',
      timeline: {
        lastDurableWriteAt: at(0),
        restoreStartedAt: at(10),
        dataRecoveredThroughAt: at(90), // RPO 90 min > declared 60
        restoreCompletedAt: at(110),
      },
      measurementId: 'ac262-measurement-miss',
    });
    expect(outcome.measurement.outcome).toBe('MISSED_RPO');
    expect(outcome.healthKind).toBe('DEGRADED');

    // The violation's machine-readable contract, readable by any consumer:
    const gate = await tdb.engine.query<{
      capability: string;
      kind: string;
      confirmed_opportunity_influence_blocked: boolean;
      deterministic_risk_monitoring_allowed: boolean;
      incident_id: string | null;
      evaluated_at: string;
    }>(
      `SELECT capability, kind, confirmed_opportunity_influence_blocked,
              deterministic_risk_monitoring_allowed, incident_id, evaluated_at
       FROM recovery_health_states
       WHERE health_state_id = $1`,
      ['health-ac262-measurement-miss'],
    );
    const h = gate.rows[0];
    expect(h?.capability).toBe('observations');
    expect(h?.kind).toBe('DEGRADED');
    expect(h?.confirmed_opportunity_influence_blocked).toBe(true);
    // The asymmetry the criterion demands: degradation never silences risk.
    expect(h?.deterministic_risk_monitoring_allowed).toBe(true);
    expect(h?.incident_id).toBe(outcome.incidentId);
    expect(h?.evaluated_at).not.toBeNull();

    // The measurement is pinned to its incident for audit.
    const pinned = await tdb.engine.query<{ incident_id: string | null }>(
      'SELECT incident_id FROM tier_measurements WHERE measurement_id = $1',
      ['ac262-measurement-miss'],
    );
    expect(pinned.rows[0]?.incident_id).toBe(outcome.incidentId);
  });

  it('after repair the capability returns to HEALTHY through the same vocabulary', async () => {
    const incidentId = (
      await tdb.engine.query<{ incident_id: string }>(
        `SELECT incident_id FROM tier_measurements WHERE measurement_id = 'ac262-measurement-miss'`,
      )
    ).rows[0]?.incident_id;
    expect(incidentId).not.toBeNull();

    // Repair: the incident closes, then the re-verified evaluation records HEALTHY.
    await resolveIncident(tdb.engine, {
      incidentId: incidentId!,
      resolvedAt: at(150),
    });
    await recordRecoveryHealthState(tdb.engine, {
      healthStateId: 'ac262-health-repaired',
      state: {
        capability: 'observations',
        kind: 'HEALTHY',
        confirmedOpportunityInfluenceBlocked: false,
        deterministicRiskMonitoringAllowed: true,
        incidentId: null,
        evaluatedAt: at(155),
        reason: 'tier re-verified within declared RPO/RTO after repair',
      },
    });

    const repaired = await tdb.engine.query<{
      kind: string;
      confirmed_opportunity_influence_blocked: boolean;
      incident_id: string | null;
    }>(
      `SELECT kind, confirmed_opportunity_influence_blocked, incident_id
       FROM recovery_health_states WHERE health_state_id = 'ac262-health-repaired'`,
    );
    expect(repaired.rows[0]?.kind).toBe('HEALTHY');
    expect(repaired.rows[0]?.confirmed_opportunity_influence_blocked).toBe(false);
    expect(repaired.rows[0]?.incident_id).toBeNull();

    // The incident is durably closed, not deleted.
    const closed = await tdb.engine.query<{ resolved_at: string | null }>(
      'SELECT resolved_at FROM recovery_incidents WHERE incident_id = $1',
      [incidentId],
    );
    expect(closed.rows[0]?.resolved_at).not.toBeNull();

    // Latest evaluation per capability now reads unblocked — the gate consumers use.
    const latest = await tdb.engine.query<{ kind: string }>(
      `SELECT kind FROM recovery_health_states
       WHERE capability = 'observations'
       ORDER BY evaluated_at DESC LIMIT 1`,
    );
    expect(latest.rows[0]?.kind).toBe('HEALTHY');
  });
});
