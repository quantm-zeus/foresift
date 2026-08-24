/**
 * AC-262 negative / failure-path.
 * Traces: FR-DR-001, FR-DR-002.
 * The degradation contract is one-directional by law: opportunity influence
 * may be blocked while deterministic risk monitoring stays allowed — never
 * both suppressed. Any health record that tries to suppress risk monitoring,
 * degrade without an incident, or claim HEALTHY while carrying an incident
 * fails typed review before it can persist.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import { recordRecoveryHealthState } from '@foresift/persistence';
import type { RecoveryHealthState } from '@foresift/domain';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

/** A well-formed degraded state to mutate per case. */
function degraded(mutate: (s: RecoveryHealthState) => RecoveryHealthState): RecoveryHealthState {
  return mutate({
    capability: 'observations',
    kind: 'DEGRADED',
    confirmedOpportunityInfluenceBlocked: true,
    deterministicRiskMonitoringAllowed: true,
    incidentId: 'incident-ac262n',
    evaluatedAt: T('2026-06-01T12:00:00Z'),
    reason: 'tier violated during drill',
  });
}

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-262 negative: illegal health states fail typed review before persistence', () => {
  it('suppressing deterministic risk monitoring alongside degradation is refused', async () => {
    await expect(
      recordRecoveryHealthState(tdb.engine, {
        healthStateId: 'ac262n-health-risk-suppressed',
        state: degraded((s) => ({ ...s, deterministicRiskMonitoringAllowed: false })),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.BACKUP_POLICY_INVALID });

    // Nothing persisted — refusal happened at review, not in the database.
    const rows = await tdb.engine.query(
      "SELECT 1 FROM recovery_health_states WHERE health_state_id = 'ac262n-health-risk-suppressed'",
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('a degraded state without an incident reference is refused', async () => {
    await expect(
      recordRecoveryHealthState(tdb.engine, {
        healthStateId: 'ac262n-health-no-incident',
        state: degraded((s) => ({ ...s, incidentId: null })),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.BACKUP_POLICY_INVALID });
  });

  it('a degraded state that leaves opportunity influence unblocked is refused', async () => {
    await expect(
      recordRecoveryHealthState(tdb.engine, {
        healthStateId: 'ac262n-health-unblocked',
        state: degraded((s) => ({ ...s, confirmedOpportunityInfluenceBlocked: false })),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.BACKUP_POLICY_INVALID });
  });

  it('a HEALTHY state carrying an incident is refused', async () => {
    await expect(
      recordRecoveryHealthState(tdb.engine, {
        healthStateId: 'ac262n-health-healthy-with-incident',
        state: {
          capability: 'observations',
          kind: 'HEALTHY',
          confirmedOpportunityInfluenceBlocked: false,
          deterministicRiskMonitoringAllowed: true,
          incidentId: 'incident-ac262n',
          evaluatedAt: T('2026-06-01T12:05:00Z'),
          reason: 'illegitimate healthy-with-incident claim',
        },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.BACKUP_POLICY_INVALID });
  });
});
