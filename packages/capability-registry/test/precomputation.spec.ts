/**
 * Bounded precomputation and trust-boundary unit suite (T026, FR-PROD-006,
 * AC-279; PRD §33.7/§10.3/§35.14).
 *
 * PGlite hooks carry explicit 120s timeouts (the full `prod` migration set is
 * applied per file).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPrecomputedAlphaRequestWithinBound,
  precomputedAlphaBoundRespected,
  utcTimestamp,
  type PrecomputedAlphaBound,
} from '@foresift/domain';
import { ImportGate } from '@foresift/security';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  assertImportedArtifactShadowOnly,
  assertLivePathBoundaryHolds,
  assertNoLivePathPrivileges,
  importShadowAssertionHolds,
  livePathReadHistory,
  recordArtifactBoundaryAssertion,
  registerPrecomputedAlphaBound,
  servePrecomputedAlpha,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const NOW = '2026-06-01T00:00:00Z';
const FUTURE = '2027-06-01T00:00:00Z';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const LIVE_PATH = 'live-path-bounded';
const REQUEST = { candidates: 10, rows: 20, edges: 30, latencyMs: 40, costUsd: 1 };

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  await registerPrecomputedAlphaBound(engine, {
    boundId: 'bound-bounded',
    livePath: LIVE_PATH,
    artifactRef: 'artifact-1',
    artifactSetHash: HASH_A,
    maxCandidates: 100,
    maxRows: 100,
    maxEdges: 100,
    maxLatencyMs: 100,
    maxCostUsd: 5,
    datasetCutoff: '2026-01-01T00:00:00Z',
    verifiedAt: '2026-01-01T00:00:00Z',
    expiresAt: FUTURE,
  });
  await engine.query(
    `INSERT INTO sec.import_artifacts
       (artifact_id, manifest_sha256, producer_key_id, format, byte_size, state,
        state_rank, step_up_approval_ref, received_at, state_changed_at)
     VALUES ('import-shadow', $1, 'producer-1', 'VERSIONED_JSON', 1024, 'SHADOW_ELIGIBLE',
             4, 'approval-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
            ('import-received', $2, 'producer-1', 'VERSIONED_JSON', 1024, 'RECEIVED',
             0, 'approval-2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    [HASH_A, HASH_B],
  );
}, 180_000);

afterAll(async () => {
  await db.close();
});

function rejection(work: Promise<unknown>): Promise<{ code?: string }> {
  return work.then(
    () => {
      throw new Error('expected a typed refusal, but the operation succeeded');
    },
    (error: unknown) => error as { code?: string },
  );
}

describe('§33.7 bounded live-path precomputed alpha', () => {
  it('serves a bounded fresh lookup and records it', async () => {
    const result = await servePrecomputedAlpha(engine, {
      livePath: LIVE_PATH,
      artifactRef: 'artifact-1',
      request: REQUEST,
      now: NOW,
      readId: 'read-served',
    });
    expect(result.served).toBe(true);
    if (result.served) {
      expect(result.bound.artifactSetHash).toBe(HASH_A);
      expect(result.bound.datasetCutoff).toBe('2026-01-01T00:00:00Z');
      expect(result.read.served).toBe(true);
      expect(result.read.refusalReason).toBeNull();
    }
    const history = await livePathReadHistory(engine, LIVE_PATH);
    expect(history.map((row) => row.readId)).toContain('read-served');
  }, 120_000);

  it('refuses a bound-exceeded or expired request instead of truncating it', async () => {
    const exceeded = await servePrecomputedAlpha(engine, {
      livePath: LIVE_PATH,
      artifactRef: 'artifact-1',
      request: { ...REQUEST, candidates: 101 },
      now: NOW,
      readId: 'read-exceeded',
    });
    expect(exceeded.served).toBe(false);
    if (!exceeded.served) {
      expect(exceeded.refusalReason).toBe('BOUND_EXCEEDED');
      expect(exceeded.read?.refusalReason).toBe('BOUND_EXCEEDED');
      expect(exceeded.detail).toMatch(/exceeds a declared/);
    }

    const expired = await servePrecomputedAlpha(engine, {
      livePath: LIVE_PATH,
      artifactRef: 'artifact-1',
      request: REQUEST,
      now: '2027-07-01T00:00:00Z',
      readId: 'read-expired',
    });
    expect(expired.served).toBe(false);
    if (!expired.served) {
      expect(expired.refusalReason).toBe('EXPIRED');
    }
  }, 120_000);

  it('refuses an unknown-artifact or fully-unbounded request with a typed reason', async () => {
    const unknown = await servePrecomputedAlpha(engine, {
      livePath: LIVE_PATH,
      artifactRef: 'artifact-unknown',
      request: REQUEST,
      now: NOW,
      readId: 'read-unknown-artifact',
    });
    expect(unknown.served).toBe(false);
    if (!unknown.served) {
      expect(unknown.refusalReason).toBe('UNKNOWN_ARTIFACT');
      expect(unknown.read?.refusalReason).toBe('UNKNOWN_ARTIFACT');
    }

    const unboundedPath = await servePrecomputedAlpha(engine, {
      livePath: 'live-path-with-no-envelope',
      artifactRef: 'artifact-1',
      request: REQUEST,
      now: NOW,
      readId: 'read-no-bound',
    });
    expect(unboundedPath.served).toBe(false);
    if (!unboundedPath.served) {
      expect(unboundedPath.refusalReason).toBe('NO_BOUND');
      // No envelope exists, so no foreign-key read row can be persisted.
      expect(unboundedPath.read).toBeNull();
    }
  }, 120_000);

  it('refuses a ceiling-less bound (unbounded) at the law and SQL level', async () => {
    const unbounded: PrecomputedAlphaBound = {
      artifactSetHash: HASH_A,
      maxCandidates: 0,
      maxRows: 0,
      maxEdges: 0,
      maxLatencyMs: 0,
      maxCostUsd: 0,
      expiresAt: FUTURE,
    };
    expect(() => precomputedAlphaBoundRespected(unbounded, REQUEST, NOW)).toThrow();
    expect(() => assertPrecomputedAlphaRequestWithinBound(unbounded, REQUEST, NOW)).toThrow();

    const sqlUnbounded = await rejection(
      engine.query(
        `INSERT INTO prod.precomputed_alpha_bounds
           (bound_id, live_path, artifact_ref, artifact_set_hash, max_candidates, max_rows,
            max_edges, max_latency_ms, max_cost_usd, dataset_cutoff, verified_at, expires_at)
         VALUES ('bound-unbounded', 'live-path-x', 'artifact-1', $1, 0, 100, 100, 100, 1,
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')`,
        [HASH_A],
      ),
    );
    // A zero/absent ceiling is refused by the SQL CHECK, never treated as unbounded.
    expect(sqlUnbounded.code).toBe('23514');
  }, 120_000);
});

describe('§10.3/§35.14 live-path trust boundary', () => {
  async function seedBoundary(livePath: string, failingKind: string | null): Promise<void> {
    const kinds = ['NO_HEAVY_JOB', 'NO_IMPORT', 'NO_PROVIDER_CALL', 'IMPORT_SHADOW_ONLY'] as const;
    for (const kind of kinds) {
      await recordArtifactBoundaryAssertion(engine, {
        assertionId: `${livePath}-${kind}`,
        livePath,
        assertionKind: kind,
        importArtifactRef: kind === 'IMPORT_SHADOW_ONLY' ? 'import-shadow' : null,
        verdict: kind === failingKind ? 'REFUSE' : 'PASS',
        assertedAt: NOW,
      });
    }
  }

  it('passes only when every assertion kind is present and passing', async () => {
    await seedBoundary('live-ok', null);
    const assertions = await assertLivePathBoundaryHolds(engine, 'live-ok');
    expect(assertions.length).toBe(4);
    expect(await importShadowAssertionHolds(engine, 'live-ok-IMPORT_SHADOW_ONLY')).toBe(true);

    await seedBoundary('live-heavy', 'NO_HEAVY_JOB');
    expect(
      await assertLivePathBoundaryHolds(engine, 'live-heavy').then(
        () => 'PASSED',
        () => 'REFUSED',
      ),
    ).toBe('REFUSED');

    await seedBoundary('live-provider', 'NO_PROVIDER_CALL');
    await expect(assertLivePathBoundaryHolds(engine, 'live-provider')).rejects.toThrow();

    await seedBoundary('live-import', 'NO_IMPORT');
    await expect(assertLivePathBoundaryHolds(engine, 'live-import')).rejects.toThrow();

    // A live path that never asserted anything refuses (not skipped).
    await expect(assertLivePathBoundaryHolds(engine, 'live-missing')).rejects.toThrow();
  }, 120_000);

  it('refuses any live-path request carrying provider, import, or decryption access', () => {
    expect(() =>
      assertNoLivePathPrivileges({
        providerCalls: false,
        artifactImports: false,
        decryption: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertNoLivePathPrivileges({
        providerCalls: true,
        artifactImports: false,
        decryption: false,
      }),
    ).toThrow();
    expect(() =>
      assertNoLivePathPrivileges({
        providerCalls: false,
        artifactImports: true,
        decryption: false,
      }),
    ).toThrow();
    expect(() =>
      assertNoLivePathPrivileges({
        providerCalls: false,
        artifactImports: false,
        decryption: true,
      }),
    ).toThrow();
  }, 120_000);

  it('lets an imported artifact reach SHADOW only with no direct-activation path', async () => {
    expect(await assertImportedArtifactShadowOnly(engine, 'import-shadow')).toBe('SHADOW_ELIGIBLE');
    await expect(assertImportedArtifactShadowOnly(engine, 'import-received')).rejects.toThrow();

    // The security quarantine machine has no ACTIVE member at all.
    const gate = new ImportGate({ engine, trustedProducers: [], verifier: () => false });
    await expect(
      gate.transition('import-shadow', 'ACTIVE' as never, utcTimestamp(NOW)),
    ).rejects.toThrow();
  }, 120_000);
});
