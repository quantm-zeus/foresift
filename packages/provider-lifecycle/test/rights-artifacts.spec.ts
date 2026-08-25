/**
 * Rights-matrix + artifact-registry suite (FR-PROV-009; T120/T121,
 * AC-259/AC-273): versioned sixteen-field declarations, the tightening-diff
 * engine with durable newly-prohibited-use sets, loosening gated on a
 * currently valid verification window, capture-time rights snapshots on
 * artifacts, exactly-once QUARANTINE|RETIRE action enumeration, and
 * explicitly recorded (never implied) action execution.
 */
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
import { AuditChain } from '@foresift/security';
import {
  ArtifactRegistry,
  ProviderAuditBridge,
  ProvErrorCode,
  RightsMatrixService,
  type RightsMatrix,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const T0 = Date.parse('2026-06-01T12:00:00Z');

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

function matrix(
  overrides?: Partial<RightsMatrix>,
): RightsMatrix {
  return {
    commercialUseAllowed: true,
    personalResearchAllowed: true,
    cacheAllowed: true,
    maximumCacheDurationSeconds: 60,
    rawRetentionAllowed: true,
    derivedFeaturesAllowed: true,
    modelTrainingAllowed: false,
    redistributionAllowed: true,
    publicAlertDerivativeAllowed: true,
    attributionRequired: true,
    userByokRequired: false,
    rawExportAllowed: true,
    jurisdictionRestrictions: [],
    termsVersion: 'terms/2026-01',
    verifiedAt: utcTimestamp('2026-06-01T00:00:00Z'),
    verificationExpiresAt: utcTimestamp('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

let db: PGlite;
let engine: DatabaseEngine;
let chain: AuditChain;
let rights: RightsMatrixService;
let artifacts: ArtifactRegistry;
const clockBox = movableClock(T0);

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
});

afterAll(async () => {
  await db.close();
});

describe('versioned declarations + tightening diff (T120)', () => {
  it('stores all sixteen fields and round-trips them exactly', async () => {
    const m = matrix();
    const { declaration } = await rights.declareVersion({
      providerId: 'prov-r',
      operationId: 'op-r',
      matrix: m,
      actor: 'rights-officer',
    });
    expect(declaration.rightsVersion).toBe(1);
    const readBack = await rights.getVersion('prov-r', 'op-r', 1);
    expect(readBack?.matrix).toEqual(m);

    const stored = await engine.query<Record<string, unknown>>(
      'SELECT * FROM prov.prov_rights_declarations WHERE provider_id = $1',
      ['prov-r'],
    );
    expect(Object.keys(stored.rows[0] ?? {}).filter((c) => !c.startsWith('provider_')).length).toBeGreaterThanOrEqual(16);
  });

  it('computes newlyProhibitedUses across versions and attests RIGHTS_CHANGE', async () => {
    const { change } = await rights.declareVersion({
      providerId: 'prov-r',
      operationId: 'op-r',
      // Tighten CACHE and RAW_RETENTION_STORAGE; loosen nothing.
      matrix: matrix({ cacheAllowed: false, rawRetentionAllowed: false }),
      actor: 'rights-officer',
    });
    expect(change?.newlyProhibitedUses.sort()).toEqual(['CACHE', 'RAW_RETENTION_STORAGE']);
    expect(change?.fromRightsVersion).toBe(1);
    expect(change?.toRightsVersion).toBe(2);
    expect(change?.changeId).toBe('prov-rights-change:prov-r:op-r:2');

    const listed = await rights.listChanges('prov-r', 'op-r');
    expect(listed).toHaveLength(1);

    const entries = await engine.query<{ action_class: string; payload_canonical: string }>(
      "SELECT action_class, payload_canonical FROM sec.sec_audit_events WHERE action_class = 'RIGHTS_CHANGE'",
    );
    expect(entries.rows).toHaveLength(1);
    expect(entries.rows[0]?.payload_canonical).toContain('RAW_RETENTION_STORAGE');
    expect((await chain.verifyRange()).run.verdict).toBe('OK');
  });

  it('refuses loosening without a currently valid verification window — nothing persists', async () => {
    const before = await rights.getVersion('prov-lax', 'op-lax', 0);
    expect(before).toBeUndefined();
    await rights.declareVersion({
      providerId: 'prov-lax',
      operationId: 'op-lax',
      matrix: matrix({ commercialUseAllowed: false }),
      actor: 'officer-a',
    });
    // Move PAST the declaration's verification window…
    clockBox.moveTo(Date.parse('2026-07-02T00:00:00Z'));
    // …then try to re-permit COMMERCIAL_USE with the same stale evidence.
    await expect(
      rights.declareVersion({
        providerId: 'prov-lax',
        operationId: 'op-lax',
        matrix: matrix({
          commercialUseAllowed: true,
          verifiedAt: utcTimestamp('2026-06-01T00:00:00Z'),
          verificationExpiresAt: utcTimestamp('2026-07-01T00:00:00Z'),
        }),
        actor: 'officer-b',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION });

    const versions = await engine.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM prov.prov_rights_declarations WHERE provider_id = 'prov-lax'",
    );
    expect(Number(versions.rows[0]?.n)).toBe(1);
    // Restore the clock for later describes.
    clockBox.moveTo(T0);
  });

  it('permits loosening when the new version carries a window still open', async () => {
    const { change } = await rights.declareVersion({
      providerId: 'prov-loose',
      operationId: 'op-loose',
      matrix: matrix({ modelTrainingAllowed: false },),
      actor: 'officer-a',
    });
    expect(change).toBeUndefined(); // first version loosens nothing
    const { declaration } = await rights.declareVersion({
      providerId: 'prov-loose',
      operationId: 'op-loose',
      matrix: matrix({
        modelTrainingAllowed: true,
        termsVersion: 'terms/2026-06',
        verifiedAt: utcTimestamp('2026-06-01T12:00:00Z'),
        verificationExpiresAt: utcTimestamp('2026-08-01T00:00:00Z'),
      }),
      actor: 'officer-b',
    });
    expect(declaration.rightsVersion).toBe(2);
    expect(declaration.matrix.modelTrainingAllowed).toBe(true);
  });
});

describe('fail-closed use decisions against CAPTURED versions (T120)', () => {
  it('unknown captured version refuses outright', async () => {
    await expect(
      rights.decideUsePath({
        providerId: 'prov-r',
        operationId: 'op-r',
        capturedRightsVersion: 99,
        usePath: 'CACHE',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN });
  });

  it('honors the captured snapshot: v1 grants what v2 later prohibited', async () => {
    // v1 allowed CACHE; v2 prohibited it. Artifacts captured at v1 keep
    // their decision basis — new ingestion captures v2.
    expect(
      await rights.decideUsePath({
        providerId: 'prov-r',
        operationId: 'op-r',
        capturedRightsVersion: 1,
        usePath: 'CACHE',
      }),
    ).toEqual({ allowed: true, reason: 'RIGHT_GRANTED' });
    expect(
      await rights.decideUsePath({
        providerId: 'prov-r',
        operationId: 'op-r',
        capturedRightsVersion: 2,
        usePath: 'CACHE',
      }),
    ).toEqual({ allowed: false, reason: 'RIGHT_PROHIBITED' });
  });

  it('an expired verification window refuses even when the boolean is true', async () => {
    // prov-loose v2 allows MODEL_TRAINING_USE but its window ends 2026-08-01.
    clockBox.moveTo(Date.parse('2026-08-01T00:00:01Z'));
    expect(
      await rights.decideUsePath({
        providerId: 'prov-loose',
        operationId: 'op-loose',
        capturedRightsVersion: 2,
        usePath: 'MODEL_TRAINING_USE',
      }),
    ).toEqual({ allowed: false, reason: 'VERIFICATION_EXPIRED' });
    clockBox.moveTo(T0);
  });
});

describe('artifact registry: capture-time snapshots + tightening actions (T121)', () => {
  it('captures artifacts ACTIVE against the CURRENT rights version', async () => {
    const a1 = await artifacts.registerArtifact({
      objectRef: 'store://prov-r/op-r/artifact-1',
      providerId: 'prov-r',
      operationId: 'op-r',
      operationVersion: '1.0.0',
      rightsVersion: 1,
      artifactId: 'art-fixed-1',
      capturedAt: utcTimestamp('2026-06-05T00:00:00Z'),
    });
    expect(a1.state).toBe('ACTIVE');
    expect(a1.rightsVersion).toBe(1);
    await artifacts.registerArtifact({
      objectRef: 'store://prov-r/op-r/artifact-2',
      providerId: 'prov-r',
      operationId: 'op-r',
      operationVersion: '1.0.0',
      rightsVersion: 2,
      artifactId: 'art-fixed-2',
      capturedAt: utcTimestamp('2026-06-06T00:00:00Z'),
    });
    expect((await artifacts.get('art-fixed-1'))?.objectRef).toBe('store://prov-r/op-r/artifact-1');
    expect(await artifacts.listActive('prov-r', 'op-r')).toHaveLength(2);
  });

  it('tightening enumerates ONLY active artifacts into exactly-one QUARANTINE rows', async () => {
    // Third tightening: REDISTRIBUTION goes away → RETIRE-grade.
    const { change } = await rights.declareVersion({
      providerId: 'prov-r',
      operationId: 'op-r',
      matrix: matrix({ cacheAllowed: false, rawRetentionAllowed: false, redistributionAllowed: false }),
      actor: 'rights-officer',
    });
    expect(change?.newlyProhibitedUses).toContain('REDISTRIBUTION');

    const planned = await artifacts.planTighteningActions(change!);
    expect(planned.map((a) => `${a.artifactId}:${a.action}`).sort()).toEqual([
      'art-fixed-1:RETIRE',
      'art-fixed-2:RETIRE',
    ]);
    expect(planned.every((a) => a.executedAt === null)).toBe(true);

    // Re-planning is a no-op — the UNIQUE fence holds exactly-once semantics.
    const replanned = await artifacts.planTighteningActions(change!);
    expect(replanned.map((a) => a.actionId)).toEqual(planned.map((a) => a.actionId));
  });

  it('non-retiring tightenings plan QUARANTINE instead', async () => {
    await rights.declareVersion({
      providerId: 'prov-q2',
      operationId: 'op-q2',
      matrix: matrix({ attributionRequired: true, personalResearchAllowed: false }),
      actor: 'officer-a',
    });
    await artifacts.registerArtifact({
      objectRef: 'store://prov-q2/a1',
      providerId: 'prov-q2',
      operationId: 'op-q2',
      operationVersion: '1.0.0',
      rightsVersion: 1,
    });
    const { change } = await rights.declareVersion({
      providerId: 'prov-q2',
      operationId: 'op-q2',
      matrix: matrix({
        attributionRequired: true,
        personalResearchAllowed: false,
        commercialUseAllowed: false,
      }),
      actor: 'officer-a',
    });
    const planned = await artifacts.planTighteningActions(change!);
    expect(planned.map((a) => a.action)).toEqual(['QUARANTINE']);
  });

  it('executing an action records executed_at, flips state, and refuses re-execution', async () => {
    const { change } = await rights.declareVersion({
      providerId: 'prov-exec',
      operationId: 'op-exec',
      matrix: matrix(),
      actor: 'officer-a',
    });
    await artifacts.registerArtifact({
      objectRef: 'store://prov-exec/a1',
      providerId: 'prov-exec',
      operationId: 'op-exec',
      operationVersion: '1.0.0',
      rightsVersion: 1,
    });
    const { change: tighten } = await rights.declareVersion({
      providerId: 'prov-exec',
      operationId: 'op-exec',
      matrix: matrix({ rawExportAllowed: false }),
      actor: 'officer-b',
    });
    const [action] = await artifacts.planTighteningActions(tighten!);
    expect(action!.action).toBe('RETIRE');

    const { action: executed, artifact } = await artifacts.executeAction(action!.actionId);
    expect(executed.executedAt).not.toBeNull();
    expect(artifact.state).toBe('RETIRED');

    await expect(artifacts.executeAction(action!.actionId)).rejects.toMatchObject({
      code: ProvErrorCode.PROV_RIGHTS_ACTION_INCOMPLETE,
    });
    expect(await artifacts.listActive('prov-exec', 'op-exec')).toHaveLength(0);
    void change;
  });

  it('QUARANTINE execution flips to QUARANTINED, not RETIRED', async () => {
    const changes = await rights.listChanges('prov-q2', 'op-q2');
    const actions = await artifacts.listActions(changes[changes.length - 1]!.changeId);
    const { artifact } = await artifacts.executeAction(actions[0]!.actionId);
    expect(artifact.state).toBe('QUARANTINED');
  });
});
