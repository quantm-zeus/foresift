/**
 * Database-side artifact index rows for object_artifacts (§14.8, T039).
 * The stage machine's transitions live here; the cross-store driver in
 * staged-commit.ts composes them with physical store operations. Transitions
 * only ever move FORWARD; each transition records its instant.
 */
import { ForesiftError, ErrorCode, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export type ArtifactStage =
  'PENDING_UPLOAD' | 'STORED_HASH_VERIFIED' | 'INDEX_COMMITTED' | 'AVAILABLE';

export interface ArtifactIndexRow {
  readonly artifactId: string;
  readonly contentHash: string;
  readonly stage: ArtifactStage;
  readonly encryptionStatus: string;
  readonly rightsRef: string | null;
  readonly retentionClass: string;
  readonly version: number;
  readonly sizeBytes: number;
  readonly uploadedAt: UtcTimestamp;
  readonly hashVerifiedAt: string | null;
  readonly indexCommittedAt: string | null;
  readonly availableAt: string | null;
}

export async function insertPendingArtifact(
  engine: DatabaseEngine,
  input: {
    artifactId: string;
    contentHash: string;
    encryptionStatus: string;
    retentionClass: string;
    version?: number;
    sizeBytes: number;
    uploadedAt: UtcTimestamp;
    rightsRef?: string | null;
  },
): Promise<void> {
  await engine.query(
    `INSERT INTO object_artifacts
       (artifact_id, content_hash, stage, encryption_status, rights_ref,
        retention_class, version, size_bytes, uploaded_at)
     VALUES ($1,$2,'PENDING_UPLOAD',$3,$4,$5,$6,$7,$8)`,
    [
      input.artifactId,
      input.contentHash,
      input.encryptionStatus,
      input.rightsRef ?? null,
      input.retentionClass,
      input.version ?? 1,
      input.sizeBytes,
      input.uploadedAt,
    ],
  );
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}

export async function loadArtifact(
  engine: DatabaseEngine,
  artifactId: string,
): Promise<ArtifactIndexRow | null> {
  const rows = await engine.query<{
    artifact_id: string;
    content_hash: string;
    stage: string;
    encryption_status: string;
    rights_ref: string | null;
    retention_class: string;
    version: number;
    size_bytes: string | number;
    uploaded_at: Date | string;
    hash_verified_at: Date | string | null;
    index_committed_at: Date | string | null;
    available_at: Date | string | null;
  }>('SELECT * FROM object_artifacts WHERE artifact_id = $1', [artifactId]);
  const r = rows.rows[0];
  if (r === undefined) return null;
  return {
    artifactId: r.artifact_id,
    contentHash: r.content_hash,
    stage: r.stage as ArtifactStage,
    encryptionStatus: r.encryption_status,
    rightsRef: r.rights_ref,
    retentionClass: r.retention_class,
    version: r.version,
    sizeBytes: Number(r.size_bytes),
    uploadedAt: utcTimestamp(toIso(r.uploaded_at)),
    hashVerifiedAt: r.hash_verified_at === null ? null : toIso(r.hash_verified_at),
    indexCommittedAt: r.index_committed_at === null ? null : toIso(r.index_committed_at),
    availableAt: r.available_at === null ? null : toIso(r.available_at),
  };
}

/** Forward-only stage transition; regression is a hard refusal. */
const STAGE_ORDER: Record<ArtifactStage, number> = {
  PENDING_UPLOAD: 0,
  STORED_HASH_VERIFIED: 1,
  INDEX_COMMITTED: 2,
  AVAILABLE: 3,
};

export async function transitionStage(
  engine: DatabaseEngine,
  input: {
    artifactId: string;
    /** The stage being recorded as reached. */
    reached: Exclude<ArtifactStage, 'PENDING_UPLOAD'>;
    at: UtcTimestamp;
  },
): Promise<ArtifactIndexRow> {
  const current = await loadArtifact(engine, input.artifactId);
  if (current === null) {
    throw new ForesiftError(
      ErrorCode.OBJECT_STAGE_TRANSITION_INVALID,
      `unknown artifact ${input.artifactId}`,
      {},
    );
  }
  if (STAGE_ORDER[input.reached] <= STAGE_ORDER[current.stage]) {
    throw new ForesiftError(
      ErrorCode.OBJECT_STAGE_TRANSITION_INVALID,
      `artifact ${input.artifactId} cannot move ${current.stage} -> ${input.reached}; stages only advance`,
      { artifactId: input.artifactId },
    );
  }
  // Decision-critical rule (§14.8), enforced unconditionally — never left to
  // caller discipline: AVAILABLE requires both sides verified. The SQL CHECK
  // (`object_artifacts_available_requires_verification`) backstops this same
  // rule for any writer that bypasses this boundary.
  if (input.reached === 'AVAILABLE') {
    if (current.hashVerifiedAt === null || current.indexCommittedAt === null) {
      throw new ForesiftError(
        ErrorCode.OBJECT_STAGE_TRANSITION_INVALID,
        `artifact ${input.artifactId} cannot become AVAILABLE before hash verification and index commit`,
        { artifactId: input.artifactId },
      );
    }
  }
  const sets: Record<Exclude<ArtifactStage, 'PENDING_UPLOAD'>, string> = {
    STORED_HASH_VERIFIED: 'stage = $2, hash_verified_at = COALESCE(hash_verified_at, $3)',
    INDEX_COMMITTED: 'stage = $2, index_committed_at = COALESCE(index_committed_at, $3)',
    AVAILABLE: 'stage = $2, available_at = COALESCE(available_at, $3)',
  };
  await engine.query(
    `UPDATE object_artifacts SET ${sets[input.reached]}, updated_at = now() WHERE artifact_id = $1`,
    [input.artifactId, input.reached, input.at],
  );
  const updated = await loadArtifact(engine, input.artifactId);
  if (updated === null) throw new Error('unreachable');
  return updated;
}
