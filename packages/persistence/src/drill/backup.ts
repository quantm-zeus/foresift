/**
 * Backup governance + deterministic snapshot mechanism (T043, FR-DR-002,
 * §34.5, ADR-0007). This module is the pre-infrastructure equivalent
 * mechanism: production PITR/WAL wiring implements the same
 * `SnapshotMechanism` interface and inherits the same drills.
 *
 * Key separation is structural (§34.5): policies persist an opaque
 * `keyref:` reference into a separately protected keystore — never key
 * material — and snapshot artifacts are scannable so a violation fails
 * loudly instead of shipping secrets into backups.
 */
import { createHash } from 'node:crypto';
import { ErrorCode, ForesiftError, type UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

// ---------------------------------------------------------------------------
// Policy records
// ---------------------------------------------------------------------------

export interface BackupPolicyRecord {
  readonly policyId: string;
  readonly retentionDays: number;
  /** e.g. 'SERVER_SIDE_AES256'; recorded, never faked. */
  readonly encryptionStatus: string;
  /** Failure-domain/location reference (validated against an allowlist). */
  readonly locationRef: string;
  /** Reference to the verified rights basis permitting this copy. */
  readonly rightsRef: string;
  readonly legalHold: boolean;
  readonly deletionPolicy: string;
  /** Opaque keystore reference — never the key itself. */
  readonly keyReference: string;
}

const KEYREF_PATTERN = /^keyref:[A-Za-z0-9._/-]+$/;

/** Text patterns that indicate actual key material rather than a reference. */
const KEY_MATERIAL_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN CERTIFICATE-----/,
  /\bPRIVATE KEY MATERIAL\b/i,
  /\baws4_secret_access_key\b/i,
];

/**
 * Validate a policy for persistence. Refuses looser-than-declared retention,
 * embedded key material (fail closed on anything that LOOKS like a secret),
 * and non-opaque key references.
 */
export function validateBackupPolicy(policy: BackupPolicyRecord): void {
  if (!Number.isInteger(policy.retentionDays) || policy.retentionDays < 1) {
    throw new ForesiftError(
      ErrorCode.BACKUP_POLICY_INVALID,
      'retentionDays must be a positive integer',
      { policyId: policy.policyId },
    );
  }
  for (const [field, value] of [
    ['encryptionStatus', policy.encryptionStatus],
    ['locationRef', policy.locationRef],
    ['rightsRef', policy.rightsRef],
    ['deletionPolicy', policy.deletionPolicy],
  ] as const) {
    if (value.trim().length === 0) {
      throw new ForesiftError(
        ErrorCode.BACKUP_POLICY_INVALID,
        `${field} must be a non-empty reference`,
        { policyId: policy.policyId, field },
      );
    }
  }
  if (!KEYREF_PATTERN.test(policy.keyReference)) {
    throw new ForesiftError(
      ErrorCode.BACKUP_POLICY_INVALID,
      'keyReference must be an opaque keyref: reference into the separated keystore',
      { policyId: policy.policyId },
    );
  }
  for (const field of [
    policy.encryptionStatus,
    policy.locationRef,
    policy.rightsRef,
    policy.deletionPolicy,
    policy.keyReference,
  ]) {
    for (const pattern of KEY_MATERIAL_PATTERNS) {
      if (pattern.test(field)) {
        throw new ForesiftError(
          ErrorCode.BACKUP_POLICY_INVALID,
          'policy record appears to embed key material; store a keyref: reference instead',
          { policyId: policy.policyId },
        );
      }
    }
  }
}

export async function createBackupPolicy(
  engine: DatabaseEngine,
  policy: BackupPolicyRecord,
  at: UtcTimestamp,
): Promise<void> {
  validateBackupPolicy(policy);
  await engine.query(
    `INSERT INTO backup_policies
       (policy_id, retention_days, encryption_status, location_ref, rights_ref,
        legal_hold, deletion_policy, key_reference, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (policy_id) DO UPDATE SET
       retention_days = EXCLUDED.retention_days,
       encryption_status = EXCLUDED.encryption_status,
       location_ref = EXCLUDED.location_ref,
       rights_ref = EXCLUDED.rights_ref,
       legal_hold = EXCLUDED.legal_hold,
       deletion_policy = EXCLUDED.deletion_policy,
       key_reference = EXCLUDED.key_reference`,
    [
      policy.policyId,
      policy.retentionDays,
      policy.encryptionStatus,
      policy.locationRef,
      policy.rightsRef,
      policy.legalHold,
      policy.deletionPolicy,
      policy.keyReference,
      at,
    ],
  );
}

export async function getBackupPolicy(
  engine: DatabaseEngine,
  policyId: string,
): Promise<BackupPolicyRecord> {
  const rows = await engine.query<{
    policy_id: string;
    retention_days: number;
    encryption_status: string;
    location_ref: string;
    rights_ref: string;
    legal_hold: boolean;
    deletion_policy: string;
    key_reference: string;
  }>('SELECT * FROM backup_policies WHERE policy_id = $1', [policyId]);
  const row = rows.rows[0];
  if (row === undefined) {
    throw new ForesiftError(ErrorCode.BACKUP_POLICY_INVALID, `unknown policy ${policyId}`, {
      policyId,
    });
  }
  return {
    policyId: row.policy_id,
    retentionDays: Number(row.retention_days),
    encryptionStatus: row.encryption_status,
    locationRef: row.location_ref,
    rightsRef: row.rights_ref,
    legalHold: row.legal_hold,
    deletionPolicy: row.deletion_policy,
    keyReference: row.key_reference,
  };
}

/** Backup runs must land only in allowlisted failure domains (§34.5). */
export function assertLocationAllowed(
  locationRef: string,
  allowedLocations: readonly string[],
): void {
  if (!allowedLocations.includes(locationRef)) {
    throw new ForesiftError(
      ErrorCode.BACKUP_POLICY_INVALID,
      `backup location ${locationRef} is not in the approved failure-domain allowlist`,
      { locationRef },
    );
  }
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export async function startBackupRun(
  engine: DatabaseEngine,
  input: { runId: string; policyId: string; startedAt: UtcTimestamp },
): Promise<void> {
  const policy = await engine.query('SELECT policy_id FROM backup_policies WHERE policy_id = $1', [
    input.policyId,
  ]);
  if (policy.rows.length === 0) {
    throw new ForesiftError(
      ErrorCode.BACKUP_POLICY_INVALID,
      `cannot run unknown policy ${input.policyId}`,
      { policyId: input.policyId },
    );
  }
  await engine.query(
    `INSERT INTO backup_runs (run_id, policy_id, started_at, status, artifact_refs)
     VALUES ($1,$2,$3,'RUNNING', ARRAY[]::text[])`,
    [input.runId, input.policyId, input.startedAt],
  );
}

export async function completeBackupRun(
  engine: DatabaseEngine,
  input: { runId: string; artifactRefs: readonly string[]; finishedAt: UtcTimestamp },
): Promise<void> {
  if (input.artifactRefs.length === 0) {
    throw new ForesiftError(
      ErrorCode.BACKUP_POLICY_INVALID,
      'a successful backup run requires at least one artifact reference',
      { runId: input.runId },
    );
  }
  const result = await engine.query<{ run_id: string }>(
    `UPDATE backup_runs SET status = 'SUCCEEDED', finished_at = $2, artifact_refs = $3
     WHERE run_id = $1 AND status = 'RUNNING'
     RETURNING run_id`,
    [input.runId, input.finishedAt, input.artifactRefs],
  );
  if (result.rows.length === 0) {
    throw new ForesiftError(
      ErrorCode.BACKUP_POLICY_INVALID,
      `run ${input.runId} is not in RUNNING state`,
      { runId: input.runId },
    );
  }
}

export async function failBackupRun(
  engine: DatabaseEngine,
  input: { runId: string; reason: string; failedAt: UtcTimestamp },
): Promise<void> {
  const result = await engine.query<{ run_id: string }>(
    `UPDATE backup_runs SET status = 'FAILED', finished_at = $2, failure_reason = $3
     WHERE run_id = $1 AND status = 'RUNNING'
     RETURNING run_id`,
    [input.runId, input.failedAt, input.reason],
  );
  if (result.rows.length === 0) {
    throw new ForesiftError(
      ErrorCode.BACKUP_POLICY_INVALID,
      `run ${input.runId} is not in RUNNING state`,
      { runId: input.runId },
    );
  }
}

// ---------------------------------------------------------------------------
// Deterministic snapshot mechanism
// ---------------------------------------------------------------------------

/**
 * The pluggable backup mechanism port (ADR-0007). The deterministic dump
 * implementation below satisfies tests/drills today; production supplies a
 * PITR/WAL-based mechanism implementing the same interface.
 */
export interface SnapshotMechanism {
  readonly mechanismKind: 'deterministic-dump' | 'pitr-wal' | 'external-managed';
  capture(at: UtcTimestamp): Promise<DatabaseSnapshot>;
}

export interface SnapshotTableArtifact {
  /** `table:<name>` */
  readonly name: string;
  readonly rowCount: number;
  /** sha256 over the canonical row JSON. */
  readonly contentHash: string;
  readonly sizeBytes: number;
}

export interface DatabaseSnapshot {
  readonly createdAt: UtcTimestamp;
  readonly mechanismKind: SnapshotMechanism['mechanismKind'];
  readonly tables: readonly SnapshotTableArtifact[];
  /** sha256 over the per-table artifact hashes in listed order. */
  readonly manifestHash: string;
  /**
   * Canonical artifact bytes (one JSON document) suitable for upload to the
   * ObjectStoreAdapter as the durable backup copy.
   */
  readonly bytes: Uint8Array;
}

interface CapturedRow {
  readonly [column: string]: unknown;
}

function canonicalRowJson(row: CapturedRow): string {
  const keys = Object.keys(row).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const value = row[key];
    const rendered =
      value instanceof Date
        ? value.toISOString()
        : typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : JSON.stringify(value);
    parts.push(`${JSON.stringify(key)}:${rendered}`);
  }
  return `{${parts.join(',')}}`;
}

function hashOf(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * Deterministically dump every public table: rows canonicalized (sorted
 * columns, lexicographically sorted rows) so identical data yields byte-
 * identical snapshots regardless of insert order or timing. Time is
 * injected (Constitution IX), never read from the wall here.
 */
export async function captureDeterministicSnapshot(
  engine: DatabaseEngine,
  at: UtcTimestamp,
): Promise<DatabaseSnapshot> {
  const tablesResult = await engine.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name NOT LIKE '_foresift%'
     ORDER BY table_name`,
  );

  const artifacts: SnapshotTableArtifact[] = [];
  const payload: Record<string, string[]> = {};

  for (const { table_name } of tablesResult.rows) {
    // Identifier comes from information_schema, quoted defensively anyway.
    const rowsResult = await engine.query<CapturedRow>(`SELECT * FROM "${table_name}"`);
    const rowTexts = rowsResult.rows.map((r) => canonicalRowJson(r)).sort();
    payload[table_name] = rowTexts;
    const text = rowTexts.join('\n');
    artifacts.push({
      name: `table:${table_name}`,
      rowCount: rowTexts.length,
      contentHash: hashOf(text),
      sizeBytes: Buffer.byteLength(text, 'utf8'),
    });
  }

  const manifestHash = hashOf(artifacts.map((a) => `${a.name}=${a.contentHash}`).join('\n'));
  const document = JSON.stringify({
    manifestHash,
    tables: Object.fromEntries(Object.entries(payload).map(([t, rows]) => [t, rows])),
  });

  return {
    createdAt: at,
    mechanismKind: 'deterministic-dump',
    tables: artifacts,
    manifestHash,
    bytes: new TextEncoder().encode(document),
  };
}

/** SnapshotMechanism backed by the deterministic dump above. */
export function deterministicSnapshotMechanism(engine: DatabaseEngine): SnapshotMechanism {
  return {
    mechanismKind: 'deterministic-dump',
    capture: (at) => captureDeterministicSnapshot(engine, at),
  };
}

// ---------------------------------------------------------------------------
// Key-material scanning (FR-DR-002, T046/T048)
// ---------------------------------------------------------------------------

export interface KeyMaterialFinding {
  readonly location: string;
  readonly pattern: string;
}

/**
 * Scan backup artifact text for embedded key material. Returns findings;
 * empty means clean. Patterns are deliberately broad — a false positive
 * blocks a backup (fail closed), a false negative would leak a secret.
 */
export function scanForKeyMaterial(
  text: string,
  location = 'artifact',
): readonly KeyMaterialFinding[] {
  const findings: KeyMaterialFinding[] = [];
  for (const pattern of KEY_MATERIAL_PATTERNS) {
    if (pattern.test(text)) {
      findings.push({ location, pattern: String(pattern) });
    }
  }
  // Opaque references are legitimate; anything else shaped like raw key
  // material (long hex/base64 blobs labeled as secrets) is flagged.
  if (/"?(private[_-]?key|secret[_-]?access[_-]?key)"?\s*[:=]\s*"[A-Za-z0-9+/]{32,}"/i.test(text)) {
    findings.push({ location, pattern: 'labeled-secret-blob' });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Deletion governance (retention execution; FR-DR-002)
// ---------------------------------------------------------------------------

export type DeletionDecision =
  | { readonly approved: true; readonly reason: string }
  | { readonly approved: false; readonly reason: string };

/**
 * Governed deletion evaluation (§14.6/§34.5): deletion executes only after
 * the retention window elapsed AND no legal hold stands. Legal hold blocks
 * unconditionally while it is in force.
 */
export function evaluateDeletionRequest(input: {
  policy: BackupPolicyRecord;
  runFinishedAt: UtcTimestamp | null;
  nowEpochMs: number;
}): DeletionDecision {
  if (input.policy.legalHold) {
    return {
      approved: false,
      reason: `policy ${input.policy.policyId} is under legal hold; deletion blocked`,
    };
  }
  if (input.runFinishedAt === null) {
    return { approved: false, reason: 'run has not finished; nothing to delete yet' };
  }
  const ageDays = (input.nowEpochMs - Date.parse(input.runFinishedAt)) / 86_400_000;
  if (ageDays < input.policy.retentionDays) {
    return {
      approved: false,
      reason: `retention window not elapsed (${ageDays.toFixed(2)}d < ${input.policy.retentionDays}d)`,
    };
  }
  return {
    approved: true,
    reason: `retention window elapsed and no legal hold on ${input.policy.policyId}`,
  };
}
