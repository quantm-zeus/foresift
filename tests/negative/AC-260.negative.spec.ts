/**
 * AC-260 negative / failure-path.
 * Traces: FR-DR-001, FR-DR-002.
 * A drill that misses a declared tier cannot pass quietly: it opens a
 * durable incident and flips the machine-readable health state so confirmed
 * opportunity influence is blocked — the "or blocks active opportunity
 * mode" arm of the criterion. A looser-than-ceiling tier registration is
 * refused outright (product law).
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  ErrorCode,
  fixedClock,
  utcTimestamp,
  type RecoveryTierId,
  type RecoveryDataClass,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  evaluateAndRecordDrill,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  registerRecoveryTier,
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

describe('AC-260 negative: missed tiers block opportunity mode and create incidents', () => {
  it('an RPO miss on the observations tier creates an incident and blocks opportunity influence', async () => {
    const engine = createEngine(targetDb!, 'pglite');
    await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    // The declared tier is a registered tier (incidents FK tier ids).
    await registerRecoveryTier(
      engine,
      {
        id: 'tier-ac260n-observations' as RecoveryTierId,
        dataClass: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
        rpoTargetMinutes: 60,
        rtoTargetMinutes: 120,
      },
      at(1),
    );

    const outcome = await evaluateAndRecordDrill({
      engine,
      clock: fixedClock(at(120)),
      tier: {
        id: 'tier-ac260n-observations' as RecoveryTierId,
        dataClass: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
        rpoTargetMinutes: 60,
        rtoTargetMinutes: 120,
      },
      capability: 'observations',
      timeline: {
        lastDurableWriteAt: at(0),
        restoreStartedAt: at(10),
        dataRecoveredThroughAt: at(80), // RPO 80 min > 60 min declared tier
        restoreCompletedAt: at(110),
      },
      measurementId: 'ac260n-measurement-rpo-miss',
    });

    expect(outcome.measurement.outcome).toBe('MISSED_RPO');
    expect(outcome.incidentId).not.toBeNull();
    expect(outcome.healthKind).toBe('DEGRADED');

    // The opportunity-mode gate is machine-readable: any consumer querying
    // recovery_health_states sees influence blocked for this capability…
    const gate = await engine.query<{
      capability: string;
      kind: string;
      confirmed_opportunity_influence_blocked: boolean;
      deterministic_risk_monitoring_allowed: boolean;
    }>(
      `SELECT capability, kind, confirmed_opportunity_influence_blocked,
              deterministic_risk_monitoring_allowed
       FROM recovery_health_states WHERE incident_id = $1`,
      [outcome.incidentId],
    );
    expect(gate.rows[0]?.capability).toBe('observations');
    expect(gate.rows[0]?.kind).toBe('DEGRADED');
    expect(gate.rows[0]?.confirmed_opportunity_influence_blocked).toBe(true);
    // …while safe deterministic risk monitoring survives the degradation.
    expect(gate.rows[0]?.deterministic_risk_monitoring_allowed).toBe(true);

    const incident = await engine.query<{ kind: string }>(
      'SELECT kind FROM recovery_incidents WHERE incident_id = $1',
      [outcome.incidentId],
    );
    expect(incident.rows[0]?.kind).toBe('RPO_MISSED');
  });

  it('registering a tier looser than the product-law RPO ceiling is refused', async () => {
    const vectors = JSON.parse(
      readFileSync(new URL('../fixtures/dr/recovery-tier-vectors.json', import.meta.url), 'utf8'),
    ) as {
      registrationVectors: readonly {
        name: string;
        dataClass: RecoveryDataClass;
        rpoTargetMinutes: number;
        rtoTargetMinutes: number;
        legal: boolean;
      }[];
    };
    const engine = createEngine(targetDb!, 'pglite');
    let index = 0;
    for (const vector of vectors.registrationVectors) {
      index += 1;
      const attempt = registerRecoveryTier(
        engine,
        {
          id: `tier-ac260n-vector-${index}` as RecoveryTierId,
          dataClass: vector.dataClass,
          rpoTargetMinutes: vector.rpoTargetMinutes,
          rtoTargetMinutes: vector.rtoTargetMinutes,
        },
        at(5 + index),
      );
      if (vector.legal) {
        await expect(attempt).resolves.toBeUndefined();
      } else {
        await expect(attempt).rejects.toMatchObject({
          code: ErrorCode.RECOVERY_TIER_CEILING_EXCEEDED,
        });
      }
    }
    expect(index).toBe(vectors.registrationVectors.length);
  });
});
