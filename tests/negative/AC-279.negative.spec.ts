// AC-279 (negative): the activation ledger refuses ROLLBACK_RESTORE events
// with no restore origin (SQL CHECK), refuses ANY UPDATE or DELETE on
// recorded history (append-only trigger), and stamps every rollback/resume
// with a pending re-evaluation marker that must be consumed before alerting.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Incidents } from '../../packages/security/src/incidents.ts';
import { GatePauses } from '../../packages/security/src/gate-pause.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

let db: PGlite;
let engine: DatabaseEngine;
let incidents: Incidents;
let ledger: GatePauses;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  incidents = new Incidents(engine);
  ledger = new GatePauses(engine);
});

afterAll(async () => {
  await db.close();
});

const SCOPE = 'config:v1-neg';

async function recordActivation(
  eventId: string,
  snapshotRef: string,
  timestamp: string,
  overrides: { scope?: string; eventType?: 'ACTIVATE' | 'ROLLBACK_RESTORE' } = {},
) {
  return ledger.recordActivation({
    eventId,
    eventType: overrides.eventType ?? 'ACTIVATE',
    scope: overrides.scope ?? SCOPE,
    at: at(timestamp),
    actor: 'release-manager@example.com',
    approvedSetSnapshotRef: snapshotRef,
  });
}

describe('AC-279 negatives: history is append-only and re-evaluation gated', () => {
  it('refuses a ROLLBACK_RESTORE event without a restore origin', async () => {
    await expect(
      recordActivation(
        'act-ac279-originless',
        'snapshot://approved/ac279/fabricated',
        '2026-08-03T00:00:00Z',
        {
          eventType: 'ROLLBACK_RESTORE',
        },
      ),
    ).rejects.toThrow(/activation_events_restore_needs_origin/);
    // The refused event left no trace.
    const history = await ledger.history(SCOPE);
    expect(history.find((e) => e.event_id === 'act-ac279-originless')).toBeUndefined();
  });

  it('refuses UPDATE and DELETE against recorded activation history', async () => {
    await recordActivation(
      'act-ac279-immutable',
      'snapshot://approved/ac279/v1',
      '2026-08-03T01:00:00Z',
    );
    for (const statement of [
      "UPDATE sec.activation_events SET actor = 'attacker' WHERE event_id = 'act-ac279-immutable'",
      "UPDATE sec.activation_events SET approved_set_snapshot_ref = 'snapshot://evil' WHERE event_id = 'act-ac279-immutable'",
      "DELETE FROM sec.activation_events WHERE event_id = 'act-ac279-immutable'",
    ]) {
      await expect(engine.query(statement)).rejects.toThrow(/AUDIT_IMMUTABLE/);
    }
  });

  it('stamps rollbacks and resumes with a pending re-evaluation marker', async () => {
    await recordActivation(
      'act-ac279-base',
      'snapshot://approved/ac279/base',
      '2026-08-03T02:00:00Z',
    );
    const rollback = await ledger.rollbackRestore({
      eventId: 'act-ac279-rollback',
      restoreOfEventId: 'act-ac279-base',
      scope: SCOPE,
      at: at('2026-08-03T03:00:00Z'),
      actor: 'oncall-security',
    });
    expect(rollback.reevaluation_marker).toBe(`pending:${rollback.event_id}`);

    // A resume likewise carries its own pending marker.
    const resumeScope = 'config:v1-resume-neg';
    await incidents.open({
      incidentId: `inc-${resumeScope}`,
      kind: 'OTHER',
      severity: 'SEV3',
      owner: 'oncall-security',
      openedAt: at('2026-08-03T04:00:00Z'),
      evidenceRefs: ['evidence://pause/triage'],
    });
    await ledger.open({
      pauseId: `pause-${resumeScope}`,
      scope: resumeScope,
      reason: 'precautionary pause before audited resume drill',
      openingIncidentId: `inc-${resumeScope}`,
      pausedAt: at('2026-08-03T04:05:00Z'),
    });
    await ledger.resume({
      pauseId: `pause-${resumeScope}`,
      resumedByActor: 'admin@example.com',
      resumedAt: at('2026-08-03T05:00:00Z'),
      auditRef: `audit://approval/${resumeScope}`,
    });
    const resumeEvents = await ledger.history(resumeScope);
    const resumeEvent = resumeEvents.at(-1);
    expect(resumeEvent?.event_type).toBe('RESUME_AFTER_RE_EVALUATION');
    expect(resumeEvent?.reevaluation_marker).toMatch(/^pending:/);
  });
});
