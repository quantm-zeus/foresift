// AC-273 (negative): post-tightening use attempts on now-prohibited paths are
// REFUSED; enumeration is COMPLETE with no silent retention; and loosening a
// right NEVER reactivates without reverification evidence inside a valid window.
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
import { ProvErrorCode, ArtifactRegistry, RightsMatrixService } from '../../packages/provider-lifecycle/src/index.ts';
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
let rights: RightsMatrixService;
let artifacts: ArtifactRegistry;
const clockBox = movableClock(Date.parse('2026-06-01T00:00:00Z'));

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  rights = new RightsMatrixService({ engine, clock: clockBox.clock });
  artifacts = new ArtifactRegistry({ engine, clock: clockBox.clock });

  await rights.declareVersion({
    providerId: 'ac273n-prov',
    operationId: 'ac273n-op',
    matrix: {
      ...RIGHTS_V1_PERMISSIVE,
      verifiedAt: utcTimestamp(RIGHTS_TIMELINE.v1VerifiedAt),
      verificationExpiresAt: utcTimestamp(RIGHTS_TIMELINE.v1ExpiresAt),
    },
    actor: 'officer-a',
  });
  for (const n of [1, 2]) {
    await artifacts.registerArtifact({
      objectRef: `store://ac273n/artifact-${n}`,
      providerId: 'ac273n-prov',
      operationId: 'ac273n-op',
      operationVersion: '1.0.0',
      rightsVersion: 1,
      artifactId: `art-n-${n}`,
    });
  }
  clockBox.moveTo(Date.parse(RIGHTS_TIMELINE.tighteningInstant));
  await rights.declareVersion({
    providerId: 'ac273n-prov',
    operationId: 'ac273n-op',
    matrix: {
      ...RIGHTS_V2_TIGHTENED,
      verifiedAt: utcTimestamp(RIGHTS_TIMELINE.tighteningInstant),
      verificationExpiresAt: utcTimestamp('2026-07-10T00:00:00Z'),
    },
    actor: 'officer-b',
  });
});

afterAll(async () => {
  await db.close();
});

describe('AC-273 negative: refusal, completeness, no silent reactivation', () => {
  it('post-change attempts on EVERY newly prohibited path are refused', async () => {
    for (const usePath of NEWLY_PROHIBITED_USES_V2) {
      // A consumer presenting the CURRENT capture (v2) is refused outright…
      const decision = await rights.decideUsePath({
        providerId: 'ac273n-prov',
        operationId: 'ac273n-op',
        capturedRightsVersion: 2,
        usePath: usePath as (typeof NEWLY_PROHIBITED_USES_V2)[number],
      });
      expect(decision.allowed, usePath).toBe(false);
      expect(decision.reason).toBe('RIGHT_PROHIBITED');

      // …and even STALE captures cannot smuggle a prohibited path through:
      // unknown versions fail closed rather than serve old grants.
      await expect(
        rights.decideUsePath({
          providerId: 'ac273n-prov',
          operationId: 'ac273n-op',
          capturedRightsVersion: 999,
          usePath: usePath as (typeof NEWLY_PROHIBITED_USES_V2)[number],
        }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN });
    }
  });

  it('enumeration is COMPLETE — no ACTIVE artifact without an action row', async () => {
    const changes = await rights.listChanges('ac273n-prov', 'ac273n-op');
    const change = changes[changes.length - 1]!;
    const planned = await artifacts.planTighteningActions(change);

    // Re-planning adds nothing (durable exactly-once rows).
    const replanned = await artifacts.planTighteningActions(change);
    expect(replanned.map((a) => a.actionId)).toEqual(planned.map((a) => a.actionId));
    expect(planned).toHaveLength(2);

    // Completeness check straight against storage: zero active artifacts
    // lacking an action row for this change.
    const missing = await engine.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM prov.prov_provider_artifacts a
       WHERE a.provider_id = $1 AND a.operation_id = $2 AND a.state = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM prov.prov_rights_change_actions x
           WHERE x.artifact_id = a.artifact_id AND x.change_id = $3)`,
      ['ac273n-prov', 'ac273n-op', change.changeId],
    );
    expect(Number(missing.rows[0]?.n)).toBe(0);

    // Unexecuted rows stay VISIBLE until someone acts on them.
    expect(planned.every((a) => a.executedAt === null)).toBe(true);
  });

  it('loosening NEVER reactivates without reverification — nothing persists', async () => {
    clockBox.moveTo(Date.parse(RIGHTS_TIMELINE.looseningAttemptInstant)); // past v1/v2 windows
    const before = await engine.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM prov.prov_rights_declarations WHERE provider_id = 'ac273n-prov'",
    );
    await expect(
      rights.declareVersion({
        providerId: 'ac273n-prov',
        operationId: 'ac273n-op',
        matrix: {
          ...RIGHTS_V2_TIGHTENED,
          modelTrainingAllowed: true, // LOOSEN
          rawExportAllowed: true, // LOOSEN
          // Stale evidence: verifiedAt/expiresAt inherited from v2 — CLOSED.
          verifiedAt: utcTimestamp(RIGHTS_TIMELINE.tighteningInstant),
          verificationExpiresAt: utcTimestamp('2026-07-10T00:00:00Z'),
        },
        actor: 'officer-c',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION });

    const after = await engine.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM prov.prov_rights_declarations WHERE provider_id = 'ac273n-prov'",
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n); // v3 never existed

    // With CURRENT reverification evidence the same loosening succeeds.
    const loosened = await rights.declareVersion({
      providerId: 'ac273n-prov',
      operationId: 'ac273n-op',
      matrix: {
        ...RIGHTS_V2_TIGHTENED,
        rawExportAllowed: true,
        verifiedAt: utcTimestamp(RIGHTS_TIMELINE.reverifiedAt),
        verificationExpiresAt: utcTimestamp(RIGHTS_TIMELINE.reverifiedExpiresAt),
        termsVersion: 'terms/reverified-v4',
      },
      actor: 'officer-d',
    });
    expect(loosened.declaration.rightsVersion).toBe(3);
    expect(
      await rights.decideUsePath({
        providerId: 'ac273n-prov',
        operationId: 'ac273n-op',
        capturedRightsVersion: 3,
        usePath: 'RAW_EXPORT',
      }),
    ).toEqual({ allowed: true, reason: 'RIGHT_GRANTED' });
    // But MODEL_TRAINING_USE stayed prohibited in this loosening.
    expect(
      await rights.decideUsePath({
        providerId: 'ac273n-prov',
        operationId: 'ac273n-op',
        capturedRightsVersion: 3,
        usePath: 'MODEL_TRAINING_USE',
      }),
    ).toEqual({ allowed: false, reason: 'RIGHT_PROHIBITED' });
  });
});
