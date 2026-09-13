// AC-278 (acceptance): a failed critical gate pauses EXACTLY the smallest
// affected scope with a durable reason linked to an incident; automatic
// reactivation is machine-refused; resume requires explicit audited
// approval and lands a re-evaluation ledger event.
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
  activationScopeHash,
  advanceState,
  clearContainment,
  containForFailedGate,
  evaluateActivationGate,
  loadContainmentFacts,
  statesFor,
} from '@foresift/capability-registry';
import {
  PROD_CONTAINMENT_SPECIFIC_CANDIDATE,
  PROD_CONTAIN_FOR_FAILED_GATE,
  PROD_FIXTURE_HASH_A,
  PROD_FIXTURE_NOW,
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

// --- prod-scoped addition (T038, FR-PROD-002, AC-278) ------------------------

describe('AC-278 prod-scoped: a failed critical gate pauses the smallest scope with a recorded reason and no auto-reactivation', () => {
  it('contains the SMALLEST specific scope for a SECURITY failure, refuses re-activation, and clears only on explicit revalidation', async () => {
    const { moduleId, scope } = PROD_CONTAINMENT_SPECIFIC_CANDIDATE;
    await advanceState(engine, {
      moduleId,
      scope,
      artifactSetHash: PROD_FIXTURE_HASH_A,
      toState: 'IMPLEMENTED',
      operationalReadiness: 'READY_FOR_ACTIVE_PROFILE',
      distributionReadiness: 'PRIVATE_ONLY',
      changeClassification: 'MATERIAL_SECURITY_OR_RIGHTS',
      reason: 'seed governed scope for containment',
      actorRef: 'ac278-prod',
      at: PROD_FIXTURE_NOW,
    });

    const outcome = await containForFailedGate(engine, PROD_CONTAIN_FOR_FAILED_GATE);
    // The specific candidate (fewest wildcards) was contained, not the wildcard.
    expect(outcome.containment.moduleId).toBe(moduleId);
    expect(outcome.containment.action).toBe('DISABLED');
    expect(outcome.containment.triggerGateKind).toBe('VERIFIED_GATE_EVIDENCE');
    expect(outcome.containment.reason).toContain('security gate failed');
    expect(outcome.containment.autoReactivationAllowed).toBe(false);
    expect(outcome.scopeHash).toBe(activationScopeHash(scope));

    const contained = await statesFor(engine, { moduleId, scope });
    expect(contained.lifecycleState).toBe('DISABLED');

    // An OPEN containment refuses the ordered activation gate.
    const open = await loadContainmentFacts(engine, moduleId);
    expect(open.length).toBe(1);
    const refused = evaluateActivationGate({
      ...passingOpportunityGateInput(scope),
      openContainment: open,
    });
    expect(refused.verdict).toBe('REFUSE');
    if (refused.verdict === 'REFUSE') {
      expect(refused.failingGate).toBe('NO_OPEN_CONTAINMENT');
      expect(refused.reason).toBe('CONTAINMENT_OPEN');
    }

    // Only an explicit revalidation event clears the containment.
    const cleared = await clearContainment(engine, {
      containmentId: outcome.containment.containmentId,
      revalidationEventRef: 'revalidation://ac278/prod',
    });
    expect(cleared.clearedByEventRef).toBe('revalidation://ac278/prod');
    expect(await loadContainmentFacts(engine, moduleId)).toEqual([]);
  }, 120_000);
});
