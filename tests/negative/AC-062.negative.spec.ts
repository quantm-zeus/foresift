/**
 * AC-062 negative / failure-path.
 * Traces: FR-DR-001, FR-DR-002.
 * The same drill harness, scripted past a tier: a restore that misses RTO
 * reports MISSED_RTO (never WITHIN_TIER), opens a durable incident, records
 * the measurement with that incident reference, and degrades the capability.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  fixedClock,
  utcTimestamp,
  type RecoveryTierId,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  evaluateAndRecordDrill,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recordTierMeasurement,
  registerRecoveryTier,
  seedDefaultRecoveryTiers,
} from '@foresift/persistence';
import {
  closeTestDatabase,
  makeTestDatabase,
  MIGRATIONS_DIR,
  type TestDatabase,
} from '../acceptance/helpers.ts';

const T0 = Date.parse('2026-06-01T12:00:00.000Z');
const at = (offsetMinutes: number): UtcTimestamp =>
  utcTimestamp(new Date(T0 + offsetMinutes * 60_000).toISOString());

let source: TestDatabase;
let targetDb: PGlite | undefined;

beforeAll(async () => {
  source = await makeTestDatabase();
  targetDb = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
});

afterAll(async () => {
  await closeTestDatabase(source);
  if (targetDb) await targetDb.close();
});

// SETUP DEPENDENCY: the tests in this describe share one migrated targetDb.
// The first test performs applyMigrations + tier seeding that later tests
// (e.g. the incident-free missed measurement) rely on; run order matters and
// is intentionally sequential within this file.
describe('AC-062 negative: a missed tier is reported as a failure, never absorbed', () => {
  it('an over-RTO restore yields MISSED_RTO with incident + degraded health', async () => {
    const engine = createEngine(targetDb!, 'pglite');
    await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    await seedDefaultRecoveryTiers(engine, at(0));
    // The drill's configured tier must be a registered tier (incidents and
    // measurements reference it by foreign key).
    await registerRecoveryTier(
      engine,
      {
        id: 'tier-ac062n-metadata' as RecoveryTierId,
        dataClass: 'CRITICAL_METADATA',
        rpoTargetMinutes: 15,
        rtoTargetMinutes: 60,
      },
      at(1),
    );

    const outcome = await evaluateAndRecordDrill({
      engine,
      clock: fixedClock(at(150)),
      tier: {
        id: 'tier-ac062n-metadata' as RecoveryTierId,
        dataClass: 'CRITICAL_METADATA',
        rpoTargetMinutes: 15,
        rtoTargetMinutes: 60,
      },
      capability: 'decisions-index',
      timeline: {
        lastDurableWriteAt: at(0),
        restoreStartedAt: at(5),
        dataRecoveredThroughAt: at(3), // RPO 3 min — fine
        restoreCompletedAt: at(140), // RTO 135 min ≫ 60 min target
      },
      measurementId: 'ac062n-measurement-missed',
    });

    expect(outcome.measurement.outcome).toBe('MISSED_RTO');
    expect(outcome.measurement.achievedRtoMinutes).toBe(135);
    expect(outcome.incidentId).toBe('incident-ac062n-measurement-missed');
    expect(outcome.healthKind).toBe('DEGRADED');

    // Durable trail: incident row, measurement carrying its reference…
    const incidents = await engine.query<{ kind: string; resolved_at: string | null }>(
      'SELECT kind, resolved_at FROM recovery_incidents WHERE incident_id = $1',
      [outcome.incidentId],
    );
    expect(incidents.rows[0]?.kind).toBe('RTO_MISSED');
    expect(incidents.rows[0]?.resolved_at).toBeNull();

    const measurements = await engine.query<{ outcome: string; incident_id: string | null }>(
      'SELECT outcome, incident_id FROM tier_measurements WHERE measurement_id = $1',
      ['ac062n-measurement-missed'],
    );
    expect(measurements.rows[0]?.outcome).toBe('MISSED_RTO');
    expect(measurements.rows[0]?.incident_id).toBe('incident-ac062n-measurement-missed');

    // …and the machine-readable degraded state blocking opportunity claims.
    const health = await engine.query<{ confirmed_opportunity_influence_blocked: boolean }>(
      'SELECT confirmed_opportunity_influence_blocked FROM recovery_health_states WHERE incident_id = $1',
      ['incident-ac062n-measurement-missed'],
    );
    expect(health.rows[0]?.confirmed_opportunity_influence_blocked).toBe(true);
  });

  it('a missed measurement can never be recorded without an incident reference', async () => {
    const engine = createEngine(targetDb!, 'pglite');
    try {
      await recordTierMeasurement(engine, {
        measurementId: 'ac062n-no-incident',
        measurement: {
          tierId: 'tier-ac062n-metadata' as RecoveryTierId,
          achievedRpoMinutes: 999,
          achievedRtoMinutes: 999,
          outcome: 'MISSED_BOTH',
        },
        measuredAt: at(200),
      });
      throw new Error('expected refusal for incident-free missed measurement');
    } catch (err) {
      expect((err as { code?: string }).code ?? '').toBe(ErrorCode.DRILL_INCIDENT_RECORDED);
    }
  });
});
