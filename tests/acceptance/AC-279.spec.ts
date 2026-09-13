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
import {
  advanceState,
  assertAlertResumptionAllowed,
  assertLivePathBoundaryHolds,
  assertNoLivePathPrivileges,
  evaluateActivationGate,
  latestRollback,
  recordArtifactBoundaryAssertion,
  rollbackToApproved,
  stateRowsFor,
} from '@foresift/capability-registry';
import {
  PROD_BOUNDARY_ASSERTIONS_COMPLETE,
  PROD_CONTAINMENT_SPECIFIC_CANDIDATE,
  PROD_FIXTURE_HASH_A,
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
let ledger: GatePauses;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  ledger = new GatePauses(engine);
}, 120_000);

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

// --- prod-scoped addition (T038, FR-PROD-002/006, AC-279) --------------------

/** Seed the quarantined import artifact the IMPORT_SHADOW_ONLY assertion refs. */
async function seedProdImportArtifact(): Promise<void> {
  await engine.query(
    `INSERT INTO sec.import_artifacts
       (artifact_id, manifest_sha256, producer_key_id, format, byte_size, state,
        state_rank, step_up_approval_ref, received_at, state_changed_at)
     VALUES ('import-artifact-prod-1', $1, 'producer-1', 'VERSIONED_JSON', 1024, 'SHADOW_ELIGIBLE',
             4, 'approval-prod', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    [PROD_FIXTURE_HASH_A],
  );
}

describe('AC-279 prod-scoped: rollback restores an approved immutable set, creates a new activation event, preserves history and blocks alert resumption', () => {
  it('rolls back an ACTIVE module to its prior approved artifact set and blocks alert resumption until re-evaluation', async () => {
    const { moduleId, scope } = PROD_CONTAINMENT_SPECIFIC_CANDIDATE;
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
        actorRef: 'ac279-prod',
        at: PROD_FIXTURE_NOW,
        gateResult,
        stateRowId,
        transitionId: `${stateRowId}-t`,
      });

    await advance('IMPLEMENTED', 'ac279-prod-1');
    await advance('AVAILABLE', 'ac279-prod-2');
    await advance('SHADOW', 'ac279-prod-3');
    await advance('PROVEN', 'ac279-prod-4');
    const gate = evaluateActivationGate(passingOpportunityGateInput(scope));
    expect(gate.verdict).toBe('PASS');
    await advance('ACTIVE', 'ac279-prod-5', gate);

    const outcome = await rollbackToApproved(engine, PROD_ROLLBACK_FIXTURE);
    expect(outcome.rollback.historyPreserved).toBe(true);
    expect(outcome.rollback.restoredArtifactSetHash).toBe(PROD_FIXTURE_HASH_A);
    expect(outcome.rollback.priorActivationEventRef).toBe('activation-prod-prior');
    expect(outcome.rollback.newActivationEventRef).toBe('activation-prod-rollback');
    expect(outcome.alertResumption).toBe('BLOCKED_PENDING_CANDIDATE_REEVALUATION');

    const latest = await latestRollback(engine, moduleId);
    expect(latest?.rollbackId).toBe('rollback-prod-1');

    // History is preserved: every prior row still exists alongside the new one.
    const rows = await stateRowsFor(engine, { moduleId, scope });
    expect(rows.length).toBe(6);

    // Alert resumption is blocked until the exact candidate re-evaluation lands.
    await expect(
      assertAlertResumptionAllowed(engine, {
        moduleId,
        completedReevaluationRef: 'reevaluation://not-the-one',
      }),
    ).rejects.toMatchObject({ code: 'PROD_ACTIVATION_GATE_REFUSED' });
    await expect(
      assertAlertResumptionAllowed(engine, {
        moduleId,
        completedReevaluationRef: PROD_ROLLBACK_FIXTURE.candidateReevaluationRef,
      }),
    ).resolves.toBeUndefined();
  }, 120_000);

  it('holds the exported live-path boundary with all four assertions and no live privileges', async () => {
    await seedProdImportArtifact();
    for (const assertion of PROD_BOUNDARY_ASSERTIONS_COMPLETE) {
      await recordArtifactBoundaryAssertion(engine, {
        assertionId: `ac279-prod-${assertion.assertionKind}`,
        livePath: PROD_LIVE_PATH,
        assertionKind: assertion.assertionKind,
        importArtifactRef: assertion.importArtifactRef,
        verdict: assertion.verdict,
        assertedAt: PROD_FIXTURE_NOW,
      });
    }
    await expect(assertLivePathBoundaryHolds(engine, PROD_LIVE_PATH)).resolves.toHaveLength(4);
    expect(() =>
      assertNoLivePathPrivileges(
        { providerCalls: false, artifactImports: false, decryption: false },
        PROD_LIVE_PATH,
      ),
    ).not.toThrow();
  }, 120_000);
});
