// AC-279 (acceptance): the activation-event ledger records every approved-set
// activation with actor + immutable snapshot reference; rollback restores a
// prior approved set by APPENDING a new event that inherits the restored
// event's snapshot — history is never rewritten.
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
import { GatePauses } from '../../packages/security/src/gate-pause.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

let db: PGlite;
let engine: DatabaseEngine;
let ledger: GatePauses;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  ledger = new GatePauses(engine);
});

afterAll(async () => {
  await db.close();
});

const SCOPE = 'config:v1';

async function recordActivation(eventId: string, snapshotRef: string, timestamp: string) {
  return ledger.recordActivation({
    eventId,
    eventType: 'ACTIVATE',
    scope: SCOPE,
    at: at(timestamp),
    actor: 'release-manager@example.com',
    approvedSetSnapshotRef: snapshotRef,
  });
}

describe('AC-279: append-only activation ledger with snapshot-preserving rollback', () => {
  let firstSnapshotRef = '';
  let firstEventId = '';

  it('records each activation with its actor and immutable snapshot ref', async () => {
    const first = await recordActivation(
      'act-ac279-v1',
      'snapshot://approved/ac279/v1',
      '2026-08-01T00:00:00Z',
    );
    expect(first.event_type).toBe('ACTIVATE');
    expect(first.actor).toBe('release-manager@example.com');
    expect(first.approved_set_snapshot_ref).toBe('snapshot://approved/ac279/v1');
    firstEventId = first.event_id;
    firstSnapshotRef = first.approved_set_snapshot_ref;

    const second = await recordActivation(
      'act-ac279-v2',
      'snapshot://approved/ac279/v2',
      '2026-08-01T06:00:00Z',
    );
    expect(second.approved_set_snapshot_ref).toBe('snapshot://approved/ac279/v2');
  });

  it('rollback appends a ROLLBACK_RESTORE that inherits the restored snapshot', async () => {
    const restore = await ledger.rollbackRestore({
      eventId: 'act-ac279-rollback',
      restoreOfEventId: firstEventId,
      scope: SCOPE,
      at: at('2026-08-01T09:00:00Z'),
      actor: 'oncall-security',
    });
    expect(restore.event_type).toBe('ROLLBACK_RESTORE');
    expect(restore.restored_from_event_id).toBe(firstEventId);
    // The restored approved set IS the prior event's immutable snapshot.
    expect(restore.approved_set_snapshot_ref).toBe(firstSnapshotRef);
    expect(restore.reevaluation_marker).toBe(`pending:${restore.event_id}`);
  });

  it('history stays intact and ordered after the rollback', async () => {
    const history = await ledger.history(SCOPE);
    expect(history.map((e) => e.event_id)).toEqual([
      'act-ac279-v1',
      'act-ac279-v2',
      'act-ac279-rollback',
    ]);
    expect(history.map((e) => e.event_type)).toEqual(['ACTIVATE', 'ACTIVATE', 'ROLLBACK_RESTORE']);
    // The original v2 event still names v2 — nothing was rewritten in place.
    const v2 = history.find((e) => e.event_id === 'act-ac279-v2');
    expect(v2?.approved_set_snapshot_ref).toBe('snapshot://approved/ac279/v2');
  });
});
