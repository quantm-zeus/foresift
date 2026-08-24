// AC-278 (acceptance): a failed critical gate pauses EXACTLY the smallest
// affected scope with a durable reason linked to an incident; automatic
// reactivation is machine-refused; resume requires explicit audited
// approval and lands a re-evaluation ledger event.
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
import { Incidents } from '../../packages/security/src/incidents.ts';
import { GatePauses, refuseAutoReactivation } from '../../packages/security/src/gate-pause.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
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

describe('AC-278: scoped pauses with durable reasons and audited resumes', () => {
  it('pauses ONLY the failed scope; unrelated scopes stay live', async () => {
    await incidents.open({
      incidentId: 'inc-ac278',
      kind: 'DATA_LEAKAGE',
      severity: 'SEV1',
      owner: 'oncall-security',
      openedAt: at('2026-08-01T00:00:00Z'),
      evidenceRefs: ['evidence://leak/report'],
    });
    await pauses.open({
      pauseId: 'pause-ac278',
      scope: 'capability:public-distribution',
      reason: 'claims gate failure — leakage class detected',
      openingIncidentId: 'inc-ac278',
      pausedAt: at('2026-08-01T00:05:00Z'),
    });
    expect(await pauses.isPaused('capability:public-distribution')).toBe(true);
    expect(await pauses.isPaused('capability:collector-ingest')).toBe(false);
    expect(await pauses.isPaused('capability:configuration-activate')).toBe(false);
  });

  it('automatic reactivation is refused as a machine-checked invariant', () => {
    expect(() => refuseAutoReactivation()).toThrow(/automatic reactivation is refused/);
  });

  it('resume requires an explicit actor AND audit reference', async () => {
    await expect(
      pauses.resume({
        pauseId: 'pause-ac278',
        resumedByActor: 'admin@example.com',
        resumedAt: at('2026-08-01T02:00:00Z'),
        auditRef: '',
      }),
    ).rejects.toMatchObject({
      code: 'SEC_PAUSE_RESUME_AUDIT_REQUIRED',
    });
    const resumed = await pauses.resume({
      pauseId: 'pause-ac278',
      resumedByActor: 'admin@example.com',
      resumedAt: at('2026-08-01T02:30:00Z'),
      auditRef: 'audit://approval/ac278',
    });
    expect(resumed.resumed_at).toBeDefined();

    // The resume landed a RE-EVALUATION ledger event before alerts resume.
    const history = await pauses.history('capability:public-distribution');
    expect(history.find((e) => e.event_type === 'RESUME_AFTER_RE_EVALUATION')).toBeDefined();
  });
});
