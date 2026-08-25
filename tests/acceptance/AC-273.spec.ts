// AC-273 (acceptance): a rights tightening IMMEDIATELY flips use decisions
// to refuse for the newly prohibited cache / raw-retention / export /
// redistribution / model-use paths, and enumerates every existing affected
// artifact into quarantine/retire actions. Scenario data comes from the
// fixture corpus; all state flows through the real rights + artifact services.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { utcTimestamp, type ClockPort } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { AuditChain } from '../../packages/security/src/index.ts';
import {
  ArtifactRegistry,
  ProviderAuditBridge,
  RightsMatrixService,
} from '../../packages/provider-lifecycle/src/index.ts';
import {
  NEWLY_PROHIBITED_USES_V2,
  RIGHTS_TIMELINE,
  RIGHTS_V1_PERMISSIVE,
  RIGHTS_V2_TIGHTENED,
} from '../fixtures/prov/governance-scenarios.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

function movableClock(startEpochMs: number): { clock: ClockPort; moveTo: (ms: number) => void } {
  let current = startEpochMs;
  return {
    clock: {
      now: () => new Date(current).toISOString().replace('.000Z', 'Z') as ReturnType<ClockPort['now']>,
      nowEpochMs: () => current,
    },
    moveTo: (ms) => {
      current = ms;
    },
  };
}

let db: PGlite;
let engine: DatabaseEngine;
let chain: AuditChain;
let rights: RightsMatrixService;
let artifacts: ArtifactRegistry;
const clockBox = movableClock(Date.parse(RIGHTS_TIMELINE.captureInstant));

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  chain = new AuditChain({ engine });
  rights = new RightsMatrixService({
    engine,
    clock: clockBox.clock,
    audit: new ProviderAuditBridge({ chain }),
  });
  artifacts = new ArtifactRegistry({ engine, clock: clockBox.clock });

  // v1 permissive, three artifacts captured against it.
  await rights.declareVersion({
    providerId: 'ac273-prov',
    operationId: 'ac273-op',
    matrix: {
      ...RIGHTS_V1_PERMISSIVE,
      verifiedAt: utcTimestamp(RIGHTS_TIMELINE.v1VerifiedAt),
      verificationExpiresAt: utcTimestamp(RIGHTS_TIMELINE.v1ExpiresAt),
    },
    actor: 'officer-a',
  });
  for (const n of [1, 2, 3]) {
    await artifacts.registerArtifact({
      objectRef: `store://ac273/artifact-${n}`,
      providerId: 'ac273-prov',
      operationId: 'ac273-op',
      operationVersion: '1.0.0',
      rightsVersion: 1,
      artifactId: `art-ac273-${n}`,
      capturedAt: utcTimestamp(RIGHTS_TIMELINE.captureInstant),
    });
  }
});

afterAll(async () => {
  await db.close();
});

describe('AC-273: tightening flips decisions and enumerates artifacts', () => {
  it('the v2 declaration computes EXACTLY the five newly prohibited uses', async () => {
    clockBox.moveTo(Date.parse(RIGHTS_TIMELINE.tighteningInstant));
    const { change } = await rights.declareVersion({
      providerId: 'ac273-prov',
      operationId: 'ac273-op',
      matrix: {
        ...RIGHTS_V2_TIGHTENED,
        verifiedAt: utcTimestamp(RIGHTS_TIMELINE.tighteningInstant),
        verificationExpiresAt: utcTimestamp('2026-07-10T00:00:00Z'),
      },
      actor: 'officer-b',
    });
    expect([...change!.newlyProhibitedUses].sort()).toEqual([...NEWLY_PROHIBITED_USES_V2].sort());

    // Audited immediately.
    const entry = await engine.query<{ action_class: string; payload_canonical: string }>(
      "SELECT action_class, payload_canonical FROM sec.sec_audit_events WHERE action_class = 'RIGHTS_CHANGE' ORDER BY seq DESC LIMIT 1",
    );
    expect(entry.rows[0]?.action_class).toBe('RIGHTS_CHANGE');
    expect(entry.rows[0]?.payload_canonical).toContain('MODEL_TRAINING_USE');
  });

  it('use decisions refuse EVERY newly prohibited path at captured version 2', async () => {
    for (const usePath of NEWLY_PROHIBITED_USES_V2) {
      const decision = await rights.decideUsePath({
        providerId: 'ac273-prov',
        operationId: 'ac273-op',
        capturedRightsVersion: 2,
        usePath: usePath as (typeof NEWLY_PROHIBITED_USES_V2)[number],
      });
      expect(decision.allowed, usePath).toBe(false);
      expect(decision.reason).toBe('RIGHT_PROHIBITED');
    }
    // Untouched paths keep their v1 semantics under the new capture.
    expect(
      await rights.decideUsePath({
        providerId: 'ac273-prov',
        operationId: 'ac273-op',
        capturedRightsVersion: 2,
        usePath: 'COMMERCIAL_USE',
      }),
    ).toEqual({ allowed: true, reason: 'RIGHT_GRANTED' });
  });

  it('every previously-active artifact is enumerated into RETIRE actions', async () => {
    const changes = await rights.listChanges('ac273-prov', 'ac273-op');
    const planned = await artifacts.planTighteningActions(changes[changes.length - 1]!);
    expect(planned).toHaveLength(3);
    // RAW_EXPORT + REDISTRIBUTION prohibitions make everything RETIRE-grade.
    expect(planned.map((a) => a.action)).toEqual(['RETIRE', 'RETIRE', 'RETIRE']);
    expect(planned.map((a) => a.artifactId).sort()).toEqual([
      'art-ac273-1',
      'art-ac273-2',
      'art-ac273-3',
    ]);

    // Execution is explicit and observable.
    for (const action of planned) {
      const { artifact } = await artifacts.executeAction(action.actionId);
      expect(artifact.state).toBe('RETIRED');
    }
    expect(await artifacts.listActive('ac273-prov', 'ac273-op')).toHaveLength(0);
    expect((await chain.verifyRange()).run.verdict).toBe('OK');
  });
});
