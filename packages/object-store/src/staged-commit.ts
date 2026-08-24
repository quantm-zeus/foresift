/**
 * Staged cross-store commit protocol (§14.8):
 *
 *   PENDING_UPLOAD -> STORED_HASH_VERIFIED -> INDEX_COMMITTED -> AVAILABLE
 *
 * Decision-critical evidence cannot become AVAILABLE until BOTH the durable
 * object and the database index are verified. The reconciler reports orphan
 * uploads, missing objects, hash mismatch, rights mismatch, and retention
 * drift as explicit findings — it never silently repairs, deletes, or
 * advances a stage past an unexplained failure.
 */
import {
  type ClockPort,
  ErrorCode,
  ForesiftError,
  utcTimestamp,
  type UtcTimestamp,
} from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import type { ObjectProtectionMetadata, ObjectStoreAdapter } from './adapter.ts';
import { dedupIdentityOf } from './adapter.ts';
import { insertPendingArtifact, transitionStage, type ArtifactIndexRow } from './artifact-index.ts';
import { sha256Hex } from './hash.ts';

/** Wall-clock fallback for callers that inject no clock (Constitution XIII). */
const wallClock: ClockPort = {
  now: () => utcTimestamp(new Date().toISOString().replace('.000Z', 'Z')),
  nowEpochMs: () => Date.now(),
};

export interface StagedUploadRequest {
  readonly artifactId: string;
  readonly bytes: Uint8Array;
  readonly metadata: ObjectProtectionMetadata;
  readonly uploadedAt: UtcTimestamp;
  /** Injected time source for the stage-transition timestamps; a default
   * wall-clock port is used when omitted. Deterministic paths (drills, tests)
   * supply one explicitly. */
  readonly now?: ClockPort | undefined;
}

/**
 * Run the full protocol for one artifact: index row (PENDING_UPLOAD), durable
 * put, byte-exact read-back verification, index commit, then AVAILABLE. Any
 * failed step leaves the row stuck at its last honestly-reached stage — the
 * reconciler's problem, not a silent pass. Transition timestamps come from the
 * injected clock when supplied (never the wall inside deterministic paths).
 */
export async function stagedUpload(
  engine: DatabaseEngine,
  store: ObjectStoreAdapter,
  request: StagedUploadRequest,
): Promise<ArtifactIndexRow> {
  const clock = request.now ?? wallClock;
  const contentHash = `sha256:${sha256Hex(request.bytes)}`;
  await insertPendingArtifact(engine, {
    artifactId: request.artifactId,
    contentHash,
    encryptionStatus: request.metadata.encryptionStatus,
    retentionClass: request.metadata.retentionClass,
    rightsRef: request.metadata.rightsRef ?? null,
    sizeBytes: request.bytes.byteLength,
    uploadedAt: request.uploadedAt,
  });

  await store.put({
    artifactId: request.artifactId,
    bytes: request.bytes,
    metadata: request.metadata,
  });
  const verification = await store.verify({ contentHash, metadata: request.metadata });
  if (verification.outcome === 'MISSING') {
    throw new ForesiftError(
      ErrorCode.OBJECT_HASH_MISMATCH,
      `object ${contentHash} missing after put; artifact ${request.artifactId} remains PENDING_UPLOAD`,
      { artifactId: request.artifactId },
    );
  }
  if (verification.outcome === 'HASH_MISMATCH') {
    throw new ForesiftError(
      ErrorCode.OBJECT_HASH_MISMATCH,
      `stored bytes hash ${verification.actual} != expected ${verification.expected}`,
      { artifactId: request.artifactId },
    );
  }
  let row = await transitionStage(engine, {
    artifactId: request.artifactId,
    reached: 'STORED_HASH_VERIFIED',
    at: clock.now(),
  });

  // Index commit: flips the row staged at PENDING_UPLOAD into
  // INDEX_COMMITTED — the governed protected-metadata subset was already
  // inserted at PENDING_UPLOAD time, so a crash before this point leaves a
  // fully-described row merely awaiting promotion.
  row = await transitionStage(engine, {
    artifactId: request.artifactId,
    reached: 'INDEX_COMMITTED',
    at: clock.now(),
  });

  // Both sides verified above; the §14.8 AVAILABLE gate is enforced
  // unconditionally inside transitionStage (and again by the SQL CHECK).
  row = await transitionStage(engine, {
    artifactId: request.artifactId,
    reached: 'AVAILABLE',
    at: clock.now(),
  });
  return row;
}

// --- Reconciler (§14.8) ------------------------------------------------------

export interface ReconciliationFinding {
  readonly artifactId: string;
  readonly kind:
    | 'ORPHAN_UPLOAD' // PENDING_UPLOAD row still unadvanced past the cutoff
    | 'MISSING_OBJECT' // index says stored, physical store disagrees
    | 'HASH_MISMATCH' // physical bytes no longer match the recorded hash
    | 'RIGHTS_METADATA_MISMATCH' // recorded rightsRef differs from the expected one
    | 'RETENTION_DRIFT'; // retention class outside the declared expectation set (index rows only)
  readonly detail: Record<string, unknown>;
}

export interface RetentionExpectation {
  readonly retentionClass: string;
}

export interface ReconciliationReport {
  readonly checked: number;
  readonly findings: readonly ReconciliationFinding[];
}

/**
 * Scheduled reconciliation over every non-PENDING index row plus stalled
 * uploads. Findings are reported; nothing is deleted or rewritten here.
 */
export async function reconcileArtifacts(
  engine: DatabaseEngine,
  store: ObjectStoreAdapter,
  input: {
    /** Rows in PENDING_UPLOAD older than this are orphans. */
    orphanAfter?: UtcTimestamp;
    /** Expected retention classes by retention class key, when governed. */
    retentionExpectations?: readonly RetentionExpectation[];
  } = {},
): Promise<ReconciliationReport> {
  const rows = await engine.query<{
    artifact_id: string;
    content_hash: string;
    stage: string;
    rights_ref: string | null;
    retention_class: string;
    encryption_status: string;
    uploaded_at: Date | string;
  }>(
    'SELECT artifact_id, content_hash, stage, rights_ref, retention_class, encryption_status, uploaded_at FROM object_artifacts ORDER BY uploaded_at',
  );
  const findings: ReconciliationFinding[] = [];
  const orphanCutoff = input.orphanAfter;
  for (const r of rows.rows) {
    if (
      r.stage === 'PENDING_UPLOAD' &&
      orphanCutoff !== undefined &&
      utcTimestamp(toIso(r.uploaded_at)) < orphanCutoff
    ) {
      findings.push({
        artifactId: r.artifact_id,
        kind: 'ORPHAN_UPLOAD',
        detail: { uploadedAt: toIso(r.uploaded_at), cutoff: String(orphanCutoff) },
      });
      continue;
    }
    if (r.stage === 'PENDING_UPLOAD') continue;

    const versions = await store.versions(r.content_hash);
    if (versions.length === 0) {
      findings.push({
        artifactId: r.artifact_id,
        kind: 'MISSING_OBJECT',
        detail: { contentHash: r.content_hash, stage: r.stage },
      });
      continue;
    }
    const verification = await store.verify({ contentHash: r.content_hash });
    if (verification.outcome === 'MISSING') {
      findings.push({
        artifactId: r.artifact_id,
        kind: 'MISSING_OBJECT',
        detail: { contentHash: r.content_hash },
      });
      continue;
    }
    if (verification.outcome === 'HASH_MISMATCH') {
      findings.push({
        artifactId: r.artifact_id,
        kind: 'HASH_MISMATCH',
        detail: { expected: verification.expected, actual: verification.actual },
      });
      continue;
    }
    // Rights drift: EVERY physical version must carry the SAME rights ref the
    // index row claims — mixed state (one version correct, another diverged)
    // is still drift. Any divergence is reported, never merged away.
    const physicalIdentity = versions.map((v) => dedupIdentityOf(v.metadata));
    const rightsDrift =
      physicalIdentity.length > 0 &&
      !physicalIdentity.every(
        (id) =>
          (JSON.parse(id) as { rightsRef: string | null }).rightsRef === (r.rights_ref ?? null),
      );
    if (rightsDrift) {
      findings.push({
        artifactId: r.artifact_id,
        kind: 'RIGHTS_METADATA_MISMATCH',
        detail: { indexRightsRef: r.rights_ref ?? null },
      });
    }
  }

  // Retention-policy allowlist check over INDEX ROWS: when expectations are
  // declared, every row must carry one of them; a class outside the
  // declaration is flagged as RETENTION_DRIFT. Unlike rights drift above,
  // this is NOT a per-version index↔store comparison — physical retention
  // classes are not diffed against the index here.
  if (input.retentionExpectations !== undefined) {
    const allowed = new Set(input.retentionExpectations.map((e) => e.retentionClass));
    for (const r of rows.rows) {
      if (!allowed.has(r.retention_class)) {
        findings.push({
          artifactId: r.artifact_id,
          kind: 'RETENTION_DRIFT',
          detail: { retentionClass: r.retention_class },
        });
      }
    }
  }
  return { checked: rows.rows.length, findings };
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}
