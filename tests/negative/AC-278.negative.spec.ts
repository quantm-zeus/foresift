// AC-278 (negative): pause lifecycle refusals — automatic reactivation is
// machine-refused, resume without an audit reference is refused, resuming an
// already-resumed or unknown pause refuses.
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
import { GatePauses, refuseAutoReactivation } from '../../packages/security/src/gate-pause.ts';
import {
  advanceState,
  clearContainment,
  containForFailedGate,
} from '@foresift/capability-registry';
import {
  PROD_CONTAINMENT_SPECIFIC_CANDIDATE,
  PROD_CONTAIN_FOR_CAPACITY_GATE,
  PROD_CONTAIN_FOR_FAILED_GATE,
  PROD_FIXTURE_HASH_A,
  PROD_FIXTURE_NOW,
} from '../fixtures/prod/index.ts';

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
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('AC-278 negatives: pauses only lift through audited explicit resumes', () => {
  it('automatic reactivation throws its dedicated typed refusal', () => {
    let threw = false;
    try {
      refuseAutoReactivation();
    } catch (error) {
      threw = true;
      expect((error as { code?: string }).code).toBe('SEC_PAUSE_AUTO_REACTIVATION_REFUSED');
      expect((error as Error).message).toMatch(/automatic reactivation is refused/);
    }
    expect(threw).toBe(true);
  });

  it('resume with an empty audit reference refuses', async () => {
    await incidents.open({
      incidentId: 'inc-ac278-neg',
      kind: 'INTRUSION_SUSPECTED',
      severity: 'SEV2',
      owner: 'oncall-security',
      openedAt: at('2026-08-02T00:00:00Z'),
      evidenceRefs: ['evidence://intrusion/triage'],
    });
    await pauses.open({
      pauseId: 'pause-ac278-neg',
      scope: 'capability:mcp-tool-invocation',
      reason: 'suspected intrusion triage in progress',
      openingIncidentId: 'inc-ac278-neg',
      pausedAt: at('2026-08-02T00:10:00Z'),
    });
    await expect(
      pauses.resume({
        pauseId: 'pause-ac278-neg',
        resumedByActor: 'admin@example.com',
        resumedAt: at('2026-08-02T01:00:00Z'),
        auditRef: '   ',
      }),
    ).rejects.toMatchObject({ code: 'SEC_PAUSE_RESUME_AUDIT_REQUIRED' });
  });

  it('a second resume of the same pause refuses (already resumed)', async () => {
    // First resume succeeds under its own audited approval…
    const first = await pauses.resume({
      pauseId: 'pause-ac278-neg',
      resumedByActor: 'admin@example.com',
      resumedAt: at('2026-08-02T02:00:00Z'),
      auditRef: 'audit://approval/ac278-neg-first',
    });
    expect(first.resumed_at).toBeDefined();
    // …any further resume finds no active pause and refuses.
    await expect(
      pauses.resume({
        pauseId: 'pause-ac278-neg',
        resumedByActor: 'admin@example.com',
        resumedAt: at('2026-08-02T03:00:00Z'),
        auditRef: 'audit://approval/ac278-neg-second',
      }),
    ).rejects.toThrow(/not actively paused/);
  });

  it('resuming an unknown pause id refuses', async () => {
    await expect(
      pauses.resume({
        pauseId: 'pause-never-opened',
        resumedByActor: 'admin@example.com',
        resumedAt: at('2026-08-02T03:00:00Z'),
        auditRef: 'audit://approval/ghost',
      }),
    ).rejects.toThrow(/not actively paused/);
  });
});

// --- prod-scoped additions (T038, FR-PROD-002, AC-278) -----------------------

describe('AC-278 prod-scoped negatives: containment is explicit and append-only', () => {
  let containmentId = '';

  beforeAll(async () => {
    const { moduleId, scope } = PROD_CONTAINMENT_SPECIFIC_CANDIDATE;
    await advanceState(engine, {
      moduleId,
      scope,
      artifactSetHash: PROD_FIXTURE_HASH_A,
      toState: 'IMPLEMENTED',
      operationalReadiness: 'READY_FOR_ACTIVE_PROFILE',
      distributionReadiness: 'PRIVATE_ONLY',
      changeClassification: 'MATERIAL_SECURITY_OR_RIGHTS',
      reason: 'seed governed scope for containment refusals',
      actorRef: 'ac278-prod-neg',
      at: PROD_FIXTURE_NOW,
    });
    const outcome = await containForFailedGate(engine, PROD_CONTAIN_FOR_FAILED_GATE);
    containmentId = outcome.containment.containmentId;
  }, 120_000);

  it('refuses a second clear of the same containment (no auto-reactivation)', async () => {
    await clearContainment(engine, {
      containmentId,
      revalidationEventRef: 'revalidation://ac278/first',
    });
    await expect(
      clearContainment(engine, {
        containmentId,
        revalidationEventRef: 'revalidation://ac278/second',
      }),
    ).rejects.toMatchObject({ code: 'PROD_ACTIVATION_GATE_REFUSED' });
  }, 120_000);

  it('refuses containing a scope that has no governed state row', async () => {
    await expect(
      containForFailedGate(engine, {
        ...PROD_CONTAIN_FOR_CAPACITY_GATE,
        affectedScopes: [
          { moduleId: 'module-never-governed', scope: PROD_CONTAINMENT_SPECIFIC_CANDIDATE.scope },
        ],
        containmentId: 'containment-ac278-unknown',
      }),
    ).rejects.toMatchObject({ code: 'PROD_ACTIVATION_SCOPE_INVALID' });
  }, 120_000);

  it('refuses an in-place SQL mutation of auto_reactivation_allowed', async () => {
    await expect(
      engine.query(
        `UPDATE prod.containment_events SET auto_reactivation_allowed = true WHERE containment_id = $1`,
        [containmentId],
      ),
    ).rejects.toThrow();
  }, 120_000);
});
