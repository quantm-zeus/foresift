/**
 * Staged cross-store commit protocol (T039, §14.8) and its negative battery
 * (T041): decision-critical evidence reaches AVAILABLE only after BOTH sides
 * verify; stage regression is refused; orphan uploads, missing objects,
 * tampered bytes, rights drift, and retention drift surface as explicit
 * findings — the reconciler never silently repairs.
 */
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { ErrorCode, ForesiftError, utcTimestamp } from '@foresift/domain';
import { applyMigrations, createEngine, type DatabaseEngine } from '@foresift/persistence';
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
  db = new PGlite();
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  root = await mkdtemp(path.join(tmpdir(), 'foresift-staged-'));
  store = new LocalFilesystemObjectStore(root);
}, 120_000);

afterAll(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
}, 30_000);

describe('staged protocol happy path (T039)', () => {
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
    // Backwards is refused…
    await expect(
      transitionStage(engine, {
        artifactId: 'art-regress',
        reached: 'STORED_HASH_VERIFIED',
        at: utcTimestamp('2026-03-01T00:02:00Z'),
      }),
    ).rejects.toThrowError(ForesiftError);
    // …and so is skipping the index-commit gate on a decision-critical row.
    await expect(
      transitionStage(engine, {
        artifactId: 'art-regress',
        reached: 'AVAILABLE',
        at: utcTimestamp('2026-03-01T00:03:00Z'),
        requireBothSidesVerified: true,
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

describe('reconciler findings are explicit, never silent repairs (T041)', () => {
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
