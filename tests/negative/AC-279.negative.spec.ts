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
import {
  advanceState,
  assertAlertResumptionAllowed,
  assertLivePathBoundaryHolds,
  assertNoLivePathPrivileges,
  evaluateActivationGate,
  recordActivationGateResult,
  recordArtifactBoundaryAssertion,
  rollbackToApproved,
} from '@foresift/capability-registry';
import {
  PROD_BOUNDARY_ASSERTIONS_IMPORT_REFERENCING,
  PROD_CONTAINMENT_SPECIFIC_CANDIDATE,
  PROD_FIXTURE_HASH_A,
  PROD_FIXTURE_HASH_B,
  PROD_FIXTURE_NOW,
  PROD_LIVE_PATH,
  PROD_ROLLBACK_FIXTURE,
  passingOpportunityGateInput,
} from '../fixtures/prod/index.ts';

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
}, 120_000);

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

// --- prod-scoped additions (T038, FR-PROD-002/006, AC-279) -------------------

describe('AC-279 prod-scoped negatives: rollback and boundary refusals', () => {
  const moduleId = PROD_CONTAINMENT_SPECIFIC_CANDIDATE.moduleId;
  const scope = PROD_CONTAINMENT_SPECIFIC_CANDIDATE.scope;

  beforeAll(async () => {
    const advance = async (
      toState: 'IMPLEMENTED' | 'AVAILABLE' | 'SHADOW' | 'PROVEN' | 'ACTIVE',
      stateRowId: string,
      gateResult: Awaited<ReturnType<typeof evaluateActivationGate>> | null = null,
    ) =>
      advanceState(engine, {
        moduleId,
        scope,
        artifactSetHash: PROD_FIXTURE_HASH_A,
        toState,
        operationalReadiness: 'READY_FOR_ACTIVE_PROFILE',
        distributionReadiness: 'PRIVATE_ONLY',
        changeClassification: 'MATERIAL_OPERATIONAL',
        reason: `advance to ${toState}`,
        actorRef: 'ac279-prod-neg',
        at: PROD_FIXTURE_NOW,
        gateResult,
        stateRowId,
        transitionId: `${stateRowId}-t`,
      });
    await advance('IMPLEMENTED', 'ac279-neg-1');
    await advance('AVAILABLE', 'ac279-neg-2');
    await advance('SHADOW', 'ac279-neg-3');
    await advance('PROVEN', 'ac279-neg-4');
    const gate = evaluateActivationGate(passingOpportunityGateInput(scope));
    await advance('ACTIVE', 'ac279-neg-5', await recordActivationGateResult(engine, gate));
  }, 120_000);

  it('refuses a rollback that reuses the prior activation event', async () => {
    await expect(
      rollbackToApproved(engine, {
        ...PROD_ROLLBACK_FIXTURE,
        newActivationEventRef: PROD_ROLLBACK_FIXTURE.priorActivationEventRef,
        rollbackId: 'rollback-reused-event',
      }),
    ).rejects.toMatchObject({ code: 'PROD_LIFECYCLE_TRANSITION_ILLEGAL' });
  }, 120_000);

  it('refuses a rollback to an artifact set that was never approved', async () => {
    await expect(
      rollbackToApproved(engine, {
        ...PROD_ROLLBACK_FIXTURE,
        restoredArtifactSetHash: PROD_FIXTURE_HASH_B,
        rollbackId: 'rollback-unapproved-set',
      }),
    ).rejects.toMatchObject({ code: 'PROD_LIFECYCLE_TRANSITION_ILLEGAL' });
  }, 120_000);

  it('blocks alert resumption until the exact re-evaluation reference completes', async () => {
    await rollbackToApproved(engine, {
      ...PROD_ROLLBACK_FIXTURE,
      rollbackId: 'rollback-ac279-neg',
    });
    await expect(
      assertAlertResumptionAllowed(engine, {
        moduleId,
        completedReevaluationRef: 'reevaluation://wrong',
      }),
    ).rejects.toMatchObject({ code: 'PROD_ACTIVATION_GATE_REFUSED' });
  }, 120_000);

  it('refuses a live path that reaches a heavy job or artifact import', async () => {
    await engine.query(
      `INSERT INTO sec.import_artifacts
         (artifact_id, manifest_sha256, producer_key_id, format, byte_size, state,
          state_rank, step_up_approval_ref, received_at, state_changed_at)
       VALUES ('import-artifact-prod-1', $1, 'producer-1', 'VERSIONED_JSON', 1024, 'SHADOW_ELIGIBLE',
               4, 'approval-prod', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [PROD_FIXTURE_HASH_A],
    );
    for (const assertion of PROD_BOUNDARY_ASSERTIONS_IMPORT_REFERENCING) {
      await recordArtifactBoundaryAssertion(engine, {
        assertionId: `ac279-neg-${assertion.assertionKind}`,
        livePath: PROD_LIVE_PATH,
        assertionKind: assertion.assertionKind,
        importArtifactRef: assertion.importArtifactRef,
        verdict: assertion.verdict,
        assertedAt: PROD_FIXTURE_NOW,
      });
    }
    await expect(assertLivePathBoundaryHolds(engine, PROD_LIVE_PATH)).rejects.toMatchObject({
      code: 'PROD_TRUST_BOUNDARY_VIOLATION',
    });
  }, 120_000);

  it('refuses a live-path request carrying provider/import/decryption access', () => {
    for (const access of [
      { providerCalls: true, artifactImports: false, decryption: false },
      { providerCalls: false, artifactImports: true, decryption: false },
      { providerCalls: false, artifactImports: false, decryption: true },
    ]) {
      expect(() => assertNoLivePathPrivileges(access, PROD_LIVE_PATH)).toThrowError(
        expect.objectContaining({ code: 'PROD_TRUST_BOUNDARY_VIOLATION' }),
      );
    }
  });
});
