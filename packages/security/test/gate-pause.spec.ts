// Capability pauses + activation ledger over sec tables (T111): minimal-scope
// pauses, machine-checked auto-reactivation refusal, explicit audited resume,
// append-only rollback ledger with immutable snapshots and re-evaluation
// markers.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Incidents } from '../src/incidents.ts';
import { GatePauses, refuseAutoReactivation } from '../src/gate-pause.ts';
import { SecErrorCode } from '../src/errors.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);
const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

let db: PGlite;
let engine: DatabaseEngine;
let incidents: Incidents;
let pauses: GatePauses;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  incidents = new Incidents(engine);
  pauses = new GatePauses(engine);
});

afterAll(async () => {
  await db.close();
});

async function seedIncident(id: string): Promise<void> {
  await incidents.open({
    incidentId: id,
    kind: 'AUDIT_CHAIN_FAILURE',
    severity: 'SEV1',
    owner: 'oncall-security',
    openedAt: at('2026-08-01T00:00:00Z'),
    evidenceRefs: ['evidence://x'],
  });
}

describe('capability pauses (AC-278)', () => {
  it('pauses exactly the smallest affected scope with a durable reason', async () => {
    await seedIncident('inc-p1');
    const pause = await pauses.open({
      pauseId: 'pause-p1',
      scope: 'capability:alpha-artifact-import',
      reason: 'critical import gate failure',
      openingIncidentId: 'inc-p1',
      pausedAt: at('2026-08-01T00:05:00Z'),
    });
    expect(pause.scope).toBe('capability:alpha-artifact-import');
    expect(await pauses.isPaused('capability:alpha-artifact-import')).toBe(true);
    // Blast radius: an unrelated scope is NOT affected.
    expect(await pauses.isPaused('capability:configuration-activate')).toBe(false);
  });

  it('auto-reactivation is refused as a machine-checked invariant', () => {
    expect(() => refuseAutoReactivation()).toThrow(/automatic reactivation is refused/);
    try {
      refuseAutoReactivation();
    } catch (err) {
      expect((err as { code?: string }).code).toBe(
        SecErrorCode.SEC_PAUSE_AUTO_REACTIVATION_REFUSED,
      );
    }
  });

  it('resume requires explicit actor AND audit reference', async () => {
    await seedIncident('inc-p2');
    await pauses.open({
      pauseId: 'pause-p2',
      scope: 'capability:collector-ingest',
      reason: 'parity gate failed',
      openingIncidentId: 'inc-p2',
      pausedAt: at('2026-08-01T00:10:00Z'),
    });
    await expect(
      pauses.resume({
        pauseId: 'pause-p2',
        resumedByActor: 'admin@example.com',
        resumedAt: at('2026-08-01T01:00:00Z'),
        auditRef: '',
      }),
    ).rejects.toMatchObject({ code: SecErrorCode.SEC_PAUSE_RESUME_AUDIT_REQUIRED });

    const resumed = await pauses.resume({
      pauseId: 'pause-p2',
      resumedByActor: 'admin@example.com',
      resumedAt: at('2026-08-01T01:30:00Z'),
      auditRef: 'audit://approval/42',
    });
    expect(resumed.resumed_at).toBeDefined();
    // Double resume refuses (already resumed rows do not match the guard).
    await expect(
      pauses.resume({
        pauseId: 'pause-p2',
        resumedByActor: 'admin@example.com',
        resumedAt: at('2026-08-01T02:00:00Z'),
        auditRef: 'audit://approval/43',
      }),
    ).rejects.toThrow();
  });

  it('resume lands a RESUME_AFTER_RE_EVALUATION ledger event with a pending marker', async () => {
    await seedIncident('inc-p3');
    await pauses.open({
      pauseId: 'pause-p3',
      scope: 'capability:alerts-dispatch',
      reason: 'claims gate failed',
      openingIncidentId: 'inc-p3',
      pausedAt: at('2026-08-01T00:15:00Z'),
    });
    await pauses.resume({
      pauseId: 'pause-p3',
      resumedByActor: 'admin@example.com',
      resumedAt: at('2026-08-01T03:00:00Z'),
      auditRef: 'audit://approval/44',
    });
    const history = await pauses.history('capability:alerts-dispatch');
    const resumeEvent = history.find((e) => e.event_type === 'RESUME_AFTER_RE_EVALUATION');
    expect(resumeEvent).toBeDefined();
    expect(resumeEvent?.reevaluation_marker).toBe('pending:pause-p3');
  });
});

describe('activation ledger (AC-279)', () => {
  it('rollback appends a NEW event referencing the restored snapshot; history intact', async () => {
    await pauses.recordActivation({
      eventId: 'ae-v1',
      eventType: 'ACTIVATE',
      scope: 'config:v1',
      at: at('2026-08-01T00:00:00Z'),
      actor: 'admin@example.com',
      approvedSetSnapshotRef: 'snapshot://approved/v1',
    });
    await pauses.recordActivation({
      eventId: 'ae-v2',
      eventType: 'ACTIVATE',
      scope: 'config:v1',
      at: at('2026-08-01T01:00:00Z'),
      actor: 'admin@example.com',
      approvedSetSnapshotRef: 'snapshot://approved/v2',
    });
    const rollback = await pauses.rollbackRestore({
      eventId: 'ae-v3',
      restoreOfEventId: 'ae-v1',
      scope: 'config:v1',
      at: at('2026-08-01T02:00:00Z'),
      actor: 'admin@example.com',
    });
    expect(rollback.event_type).toBe('ROLLBACK_RESTORE');
    expect(rollback.restored_from_event_id).toBe('ae-v1');
    // The restored set is v1's IMMUTABLE snapshot reference.
    expect(rollback.approved_set_snapshot_ref).toBe('snapshot://approved/v1');

    const history = await pauses.history('config:v1');
    expect(history.map((e) => e.event_id)).toEqual(['ae-v1', 'ae-v2', 'ae-v3']);
  });

  it('ledger history cannot be mutated or deleted (SQL trigger)', async () => {
    await expect(
      engine.query("UPDATE sec.activation_events SET actor = 'attacker' WHERE event_id = 'ae-v1'"),
    ).rejects.toThrow(/AUDIT_IMMUTABLE/);
    await expect(
      engine.query("DELETE FROM sec.activation_events WHERE event_id = 'ae-v3'"),
    ).rejects.toThrow(/AUDIT_IMMUTABLE/);
  });

  it('ROLLBACK_RESTORE without a restore origin is refused (SQL CHECK)', async () => {
    await expect(
      pauses.recordActivation({
        eventId: 'ae-bad',
        eventType: 'ROLLBACK_RESTORE',
        scope: 'config:x',
        at: at('2026-08-01T04:00:00Z'),
        actor: 'x',
        approvedSetSnapshotRef: 'snapshot://approved/x',
      }),
    ).rejects.toThrow(/activation_events_restore_needs_origin|ROLLBACK_RESTORE/i);
  });

  it('rollback emits a re-evaluation marker before alerts may resume', async () => {
    const rollback = await pauses.rollbackRestore({
      eventId: 'ae-v4',
      restoreOfEventId: 'ae-v2',
      scope: 'config:v1',
      at: at('2026-08-01T05:00:00Z'),
      actor: 'admin@example.com',
    });
    expect(rollback.reevaluation_marker).toBe('pending:ae-v4');
  });
});

describe('gate-pause fail-closed edges (M12/M13)', () => {
  it('resume refuses WHITESPACE-only actors and audit references (M12)', async () => {
    await seedIncident('inc-ws');
    await pauses.open({
      pauseId: 'pause-ws',
      scope: 'capability:ws-probe',
      reason: 'probe',
      openingIncidentId: 'inc-ws',
      pausedAt: at('2026-08-01T04:00:00Z'),
    });
    await expect(
      pauses.resume({
        pauseId: 'pause-ws',
        resumedByActor: '   ',
        resumedAt: at('2026-08-01T04:10:00Z'),
        auditRef: 'audit://ok',
      }),
    ).rejects.toMatchObject({ code: SecErrorCode.SEC_PAUSE_RESUME_AUDIT_REQUIRED });
    await expect(
      pauses.resume({
        pauseId: 'pause-ws',
        resumedByActor: 'admin@example.com',
        resumedAt: at('2026-08-01T04:20:00Z'),
        auditRef: '  ',
      }),
    ).rejects.toMatchObject({ code: SecErrorCode.SEC_PAUSE_RESUME_AUDIT_REQUIRED });
    // Both refusals left the pause ACTIVE.
    await expect(
      pauses.resume({
        pauseId: 'pause-ws',
        resumedByActor: 'admin@example.com',
        resumedAt: at('2026-08-01T04:30:00Z'),
        auditRef: 'audit://approval/ws',
      }),
    ).resolves.toBeDefined();
  });

  it('rollbackRestore REFUSES cross-scope restore points and non-ACTIVATE events (M13)', async () => {
    await pauses.recordActivation({
      eventId: 'ae-m13-base',
      eventType: 'ACTIVATE',
      scope: 'scope:m13',
      at: at('2026-08-01T05:00:00Z'),
      actor: 'admin@example.com',
      approvedSetSnapshotRef: 'snapshot://approved/m13',
    });
    // Cross-scope restore would silently transplant another scope's
    // approved-set snapshot — refused outright.
    await expect(
      pauses.rollbackRestore({
        eventId: 'ae-m13-cross',
        restoreOfEventId: 'ae-m13-base',
        scope: 'scope:somewhere-else',
        at: at('2026-08-01T05:10:00Z'),
        actor: 'admin@example.com',
      }),
    ).rejects.toThrow(/across scopes/);
    // A ROLLBACK_RESTORE row carries no restore-worthy snapshot of its own;
    // only ACTIVATE events may anchor a rollback (ae-v3 seeded by the ledger
    // test above in this sequential file).
    await expect(
      pauses.rollbackRestore({
        eventId: 'ae-m13-wrongtype',
        restoreOfEventId: 'ae-v3',
        scope: 'config:v1',
        at: at('2026-08-01T05:20:00Z'),
        actor: 'admin@example.com',
      }),
    ).rejects.toThrow(/only ACTIVATE events/);
  });
});
