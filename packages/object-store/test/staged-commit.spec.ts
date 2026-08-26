/**
 * Staged cross-store commit protocol (§14.8) and its negative battery: decision-critical evidence reaches AVAILABLE only after BOTH sides
 * verify; stage regression is refused; orphan uploads, missing objects,
 * tampered bytes, rights drift, and retention drift surface as explicit
 * findings — the reconciler never silently repairs.
 */
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { fixedClock, ErrorCode, ForesiftError, utcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  insertPendingArtifact,
  LocalFilesystemObjectStore,
  loadArtifact,
  reconcileArtifacts,
  stagedUpload,
  transitionStage,
  type ObjectProtectionMetadata,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let root: string;
let store: LocalFilesystemObjectStore;

const META: ObjectProtectionMetadata = {
  contentType: 'application/octet-stream',
  compression: 'GZIP',
  encryptionStatus: 'SERVER_SIDE_AES256',
  rightsRef: null,
  retentionClass: 'RAW_PROVIDER_PAYLOAD_7D',
};

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  root = await mkdtemp(path.join(tmpdir(), 'foresift-staged-'));
  store = new LocalFilesystemObjectStore(root);
}, 120_000);

afterAll(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
}, 30_000);

describe('staged protocol happy path', () => {
  it('advances PENDING_UPLOAD -> STORED_HASH_VERIFIED -> INDEX_COMMITTED -> AVAILABLE', async () => {
    const bytes = new TextEncoder().encode('decision-critical-evidence');
    const row = await stagedUpload(engine, store, {
      artifactId: 'art-ok',
      bytes,
      metadata: META,
      uploadedAt: utcTimestamp('2026-03-01T00:00:00Z'),
    });
    expect(row.stage).toBe('AVAILABLE');
    expect(row.hashVerifiedAt).not.toBeNull();
    expect(row.indexCommittedAt).not.toBeNull();
    expect(row.availableAt).not.toBeNull();
    expect(row.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('stamps every transition from the INJECTED clock, never the wall', async () => {
    const bytes = new TextEncoder().encode('clock-injected-evidence');
    const scripted = fixedClock(utcTimestamp('2026-05-05T05:05:05.555Z'));
    const row = await stagedUpload(engine, store, {
      artifactId: 'art-clock',
      bytes,
      metadata: META,
      uploadedAt: utcTimestamp('2026-05-05T05:00:00Z'),
      now: scripted,
    });
    expect(row.stage).toBe('AVAILABLE');
    expect(row.hashVerifiedAt).toBe('2026-05-05T05:05:05.555Z');
    expect(row.indexCommittedAt).toBe('2026-05-05T05:05:05.555Z');
    expect(row.availableAt).toBe('2026-05-05T05:05:05.555Z');
  });

  it('refuses stage regression and skips-ahead transitions', async () => {
    const bytes = new TextEncoder().encode('regression-target');
    await insertPendingArtifact(engine, {
      artifactId: 'art-regress',
      contentHash: `sha256:${'11'.repeat(32)}`,
      encryptionStatus: META.encryptionStatus,
      retentionClass: META.retentionClass,
      sizeBytes: bytes.byteLength,
      uploadedAt: utcTimestamp('2026-03-01T00:00:00Z'),
    });
    await transitionStage(engine, {
      artifactId: 'art-regress',
      reached: 'STORED_HASH_VERIFIED',
      at: utcTimestamp('2026-03-01T00:01:00Z'),
    });
    // A same-stage repeat (no forward progress) is refused…
    await expect(
      transitionStage(engine, {
        artifactId: 'art-regress',
        reached: 'STORED_HASH_VERIFIED',
        at: utcTimestamp('2026-03-01T00:02:00Z'),
      }),
    ).rejects.toThrowError(ForesiftError);
    // …and so is skipping the index-commit gate: the §14.8 rule is enforced
    // unconditionally, with no opt-in flag a caller could omit.
    await expect(
      transitionStage(engine, {
        artifactId: 'art-regress',
        reached: 'AVAILABLE',
        at: utcTimestamp('2026-03-01T00:03:00Z'),
      }),
    ).rejects.toThrowError(/cannot become AVAILABLE before hash verification and index commit/);
  });

  it('fails loudly when the physical object disappears before hash verification', async () => {
    const bytes = new TextEncoder().encode('vanishing-object');
    // A store that claims the put succeeded but loses the bytes.
    const flaky = {
      put: store.put.bind(store),
      get: store.get.bind(store),
      versions: store.versions.bind(store),
      async verify() {
        return { outcome: 'MISSING' as const };
      },
    };
    const err = await stagedUpload(engine, flaky, {
      artifactId: 'art-flaky',
      bytes,
      metadata: META,
      uploadedAt: utcTimestamp('2026-03-01T00:00:00Z'),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForesiftError);
    expect((err as ForesiftError).code).toBe(ErrorCode.OBJECT_HASH_MISMATCH);
    // The row stays honestly stuck at PENDING_UPLOAD for reconciliation.
    const stuck = await loadArtifact(engine, 'art-flaky');
    expect(stuck!.stage).toBe('PENDING_UPLOAD');
  });
});

describe('reconciler findings are explicit, never silent repairs', () => {
  it('detects orphan uploads past the cutoff', async () => {
    await insertPendingArtifact(engine, {
      artifactId: 'art-orphan',
      contentHash: `sha256:${'22'.repeat(32)}`,
      encryptionStatus: META.encryptionStatus,
      retentionClass: META.retentionClass,
      sizeBytes: 10,
      uploadedAt: utcTimestamp('2026-02-01T00:00:00Z'),
    });
    const report = await reconcileArtifacts(engine, store, {
      orphanAfter: utcTimestamp('2026-02-15T00:00:00Z'),
    });
    const orphan = report.findings.find((f) => f.artifactId === 'art-orphan');
    expect(orphan?.kind).toBe('ORPHAN_UPLOAD');
  });

  it('detects missing objects and refuses to pretend the index is fine', async () => {
    const bytes = new TextEncoder().encode('to-be-deleted-from-disk');
    const row = await stagedUpload(engine, store, {
      artifactId: 'art-vanish',
      bytes,
      metadata: META,
      uploadedAt: utcTimestamp('2026-03-02T00:00:00Z'),
    });
    const hex = row.contentHash.slice('sha256:'.length);
    await unlink(path.join(root, 'objects', hex.slice(0, 2), hex, `v${row.version}.blob`));
    const report = await reconcileArtifacts(engine, store);
    expect(
      report.findings.some((f) => f.artifactId === 'art-vanish' && f.kind === 'MISSING_OBJECT'),
    ).toBe(true);
  });

  it('detects tampered bytes as HASH_MISMATCH without rewriting anything', async () => {
    const bytes = new TextEncoder().encode('tamper-me-later');
    const row = await stagedUpload(engine, store, {
      artifactId: 'art-tamper',
      bytes,
      metadata: META,
      uploadedAt: utcTimestamp('2026-03-03T00:00:00Z'),
    });
    const hex = row.contentHash.slice('sha256:'.length);
    await writeFile(
      path.join(root, 'objects', hex.slice(0, 2), hex, `v${row.version}.blob`),
      new TextEncoder().encode('tampered-after-the-fact'),
    );
    const report = await reconcileArtifacts(engine, store);
    const finding = report.findings.find((f) => f.artifactId === 'art-tamper');
    expect(finding?.kind).toBe('HASH_MISMATCH');
    // No silent repair: the physical bytes were left exactly as tampered.
    expect(await store.verify({ contentHash: row.contentHash })).toMatchObject({
      outcome: 'HASH_MISMATCH',
    });
  });

  it('flags RIGHTS_METADATA_MISMATCH when index and object disagree on rights', async () => {
    const bytes = new TextEncoder().encode('rights-drift-case');
    await stagedUpload(engine, store, {
      artifactId: 'art-rights',
      bytes,
      metadata: { ...META, rightsRef: null },
      uploadedAt: utcTimestamp('2026-03-04T00:00:00Z'),
    });
    // The index row now claims a restriction the physical side never carried.
    await engine.query(
      `UPDATE object_artifacts SET rights_ref = 'license:sudden-restriction' WHERE artifact_id = $1`,
      ['art-rights'],
    );
    const report = await reconcileArtifacts(engine, store);
    expect(
      report.findings.some(
        (f) => f.artifactId === 'art-rights' && f.kind === 'RIGHTS_METADATA_MISMATCH',
      ),
    ).toBe(true);
  });

  it('flags RETENTION_DRIFT against governed expectations', async () => {
    const report = await reconcileArtifacts(engine, store, {
      retentionExpectations: [{ retentionClass: 'FROZEN_ALERT_EVIDENCE_24MO' }],
    });
    const drifted = report.findings.filter((f) => f.kind === 'RETENTION_DRIFT');
    // Every RAW_PROVIDER_PAYLOAD_7D row has drifted from the sole declared class.
    expect(drifted.length).toBeGreaterThanOrEqual(3);
    expect(drifted.every((f) => typeof f.detail.retentionClass === 'string')).toBe(true);
  });
});

describe('§14.8 AVAILABLE gate is enforced, not promised (review regressions)', () => {
  it('SQL refuses an AVAILABLE row that lacks hash verification and index commit', async () => {
    // The app-layer gate is not the only line of defense: SQL truth refuses
    // any writer that skips both sides' verification.
    await expect(
      engine.query(
        `INSERT INTO object_artifacts
           (artifact_id, content_hash, stage, encryption_status, retention_class,
            version, size_bytes, uploaded_at, available_at)
         VALUES ('art-sql-gate', $1, 'AVAILABLE', 'SERVER_SIDE_AES256',
                 'RAW_PROVIDER_PAYLOAD_7D', 1, 5, $2, $2)`,
        [`sha256:${'aa'.repeat(32)}`, utcTimestamp('2026-03-05T00:00:00Z')],
      ),
    ).rejects.toThrow(/object_artifacts_available_requires_verification/);

    // The same row becomes insertable only once BOTH verifications are on record.
    await engine.query(
      `INSERT INTO object_artifacts
         (artifact_id, content_hash, stage, encryption_status, retention_class,
          version, size_bytes, uploaded_at, hash_verified_at, index_committed_at, available_at)
       VALUES ('art-sql-gate-ok', $1, 'AVAILABLE', 'SERVER_SIDE_AES256',
               'RAW_PROVIDER_PAYLOAD_7D', 1, 5, $2, $2, $2, $2)`,
      [`sha256:${'bb'.repeat(32)}`, utcTimestamp('2026-03-05T00:01:00Z')],
    );
    const row = await loadArtifact(engine, 'art-sql-gate-ok');
    expect(row?.stage).toBe('AVAILABLE');
  });

  it('flags RIGHTS_METADATA_MISMATCH for MIXED physical versions (not just total divergence)', async () => {
    const bytes = new TextEncoder().encode('mixed-rights-drift-case');
    // v1: unrestricted identity (index will agree with it).
    await stagedUpload(engine, store, {
      artifactId: 'art-mixed-rights',
      bytes,
      metadata: { ...META, rightsRef: null },
      uploadedAt: utcTimestamp('2026-03-06T00:00:00Z'),
    });
    // v2: SAME bytes, DIFFERENT protected metadata — a second dedup identity
    // under one content hash. One version matches the index; one does not.
    await store.put({
      artifactId: 'art-mixed-rights-v2',
      bytes,
      metadata: { ...META, rightsRef: 'license:mixed-drift' },
    });
    const report = await reconcileArtifacts(engine, store);
    expect(
      report.findings.some(
        (f) => f.artifactId === 'art-mixed-rights' && f.kind === 'RIGHTS_METADATA_MISMATCH',
      ),
    ).toBe(true);
  });
});
