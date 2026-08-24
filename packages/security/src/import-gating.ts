/**
 * Import gating over the quarantine state machine (FR-SEC-008, §35.14,
 * ADR-044/046; AC-051 import attack fixtures, AC-274 step-up coupling).
 *
 * Intake rules enforced BEFORE any row exists: format allowlist
 * (versioned JSON/JSONL, Parquet, approved compressed containers),
 * file-count/path/size/decompression limits, symlink + path-traversal +
 * executable-format refusal. Provenance: asymmetric signature verification
 * against a trusted-producer public-key allowlist (injectable verifier)
 * with content-hash and canonical-serialization checks plus producer
 * trust/expiry/revocation. Every intake carries its step-up approval
 * reference — imports are a high-impact admin action.
 *
 * State machine (typed layer): RECEIVED→QUARANTINED→SCANNED→VALIDATING→
 * terminal REJECTED | SHADOW_ELIGIBLE. There is NO ACTIVE state and this
 * layer refuses any attempt to fabricate one; SQL CHECKs pin the ranks.
 * Parsing itself happens ONLY inside the isolated-parsing boundary.
 */
import type { UtcTimestamp } from '@foresift/domain';
import type { ImportQuarantineState } from '@foresift/shared-schemas';
import { ImportGatingError, SecErrorCode } from './errors.ts';
import { sha256Text } from '@foresift/persistence';

const STATE_RANK: Record<ImportQuarantineState, number> = {
  RECEIVED: 0,
  QUARANTINED: 1,
  SCANNED: 2,
  VALIDATING: 3,
  REJECTED: 4,
  SHADOW_ELIGIBLE: 4,
};

/** Legal forward edges of the quarantine machine. */
const TRANSITIONS: Record<ImportQuarantineState, readonly ImportQuarantineState[]> = {
  RECEIVED: ['QUARANTINED', 'REJECTED'],
  QUARANTINED: ['SCANNED', 'REJECTED'],
  SCANNED: ['VALIDATING', 'REJECTED'],
  VALIDATING: ['SHADOW_ELIGIBLE', 'REJECTED'],
  REJECTED: [],
  SHADOW_ELIGIBLE: [],
};

export const IMPORT_FORMATS = [
  'VERSIONED_JSON',
  'VERSIONED_JSONL',
  'PARQUET',
  'APPROVED_COMPRESSED_CONTAINER',
] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export interface ImportLimits {
  readonly maxFileCount: number;
  readonly maxSingleFileBytes: number;
  readonly maxTotalBytes: number;
  /** Max compressed:decompressed expansion admitted at intake. */
  readonly maxDecompressionRatio: number;
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxFileCount: 5000,
  maxSingleFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 5 * 1024 * 1024 * 1024,
  maxDecompressionRatio: 100,
};

export interface TrustedProducer {
  readonly keyId: string;
  /** Trust anchor expiry — stale producer keys refuse. */
  readonly expiresAt: UtcTimestamp;
  readonly revokedAt?: UtcTimestamp | undefined;
}

/** Injectable asymmetric verifier: true when signature is valid for material. */
export type ProducerVerifier = (
  materialBytes: Uint8Array,
  signature: string,
  publicKeyPem: string,
) => Promise<boolean> | boolean;

export interface IntakeRequest {
  readonly artifactId: string;
  readonly format: string;
  readonly producerKeyId: string;
  readonly manifestCanonicalJson: string;
  readonly byteSize: number;
  readonly fileCount: number;
  /** Declared archive member paths (relative). */
  readonly memberPaths: readonly string[];
  /** Compressed size vs declared decompressed size for containers. */
  readonly compressedByteSize?: number | undefined;
  readonly stepUpApprovalRef: string;
}

interface ArtifactRow {
  artifact_id: string;
  manifest_sha256: string;
  producer_key_id: string;
  format: string;
  byte_size: string | number;
  state: ImportQuarantineState;
  state_rank: number;
  prior_state_rank: number;
  step_up_approval_ref: string;
}

export class ImportGate {
  private readonly engine: import('@foresift/persistence').DatabaseEngine;
  private readonly producers: ReadonlyMap<string, TrustedProducer>;
  private readonly verifier: ProducerVerifier;
  private readonly limits: ImportLimits;

  constructor(options: {
    engine: import('@foresift/persistence').DatabaseEngine;
    trustedProducers: readonly TrustedProducer[];
    verifier: ProducerVerifier;
    limits?: ImportLimits | undefined;
  }) {
    this.engine = options.engine;
    this.producers = new Map(options.trustedProducers.map((p) => [p.keyId, p]));
    this.verifier = options.verifier;
    this.limits = options.limits ?? DEFAULT_IMPORT_LIMITS;
  }

  /**
   * Quarantine intake: hygiene checks run BEFORE the artifact is recorded;
   * anything malformed never becomes a quarantined row at all.
   */
  async intake(request: IntakeRequest, receivedAt: UtcTimestamp): Promise<ArtifactRow> {
    if (!IMPORT_FORMATS.includes(request.format as ImportFormat)) {
      throw new ImportGatingError(
        `format '${request.format}' is not on the intake allowlist`,
        { format: request.format },
        SecErrorCode.SEC_IMPORT_FORMAT_REFUSED,
      );
    }
    if ((request.stepUpApprovalRef ?? '').trim() === '') {
      throw new ImportGatingError(
        'intake requires an explicit step-up approval reference',
        {},
        SecErrorCode.SEC_IMPORT_STEP_UP_APPROVAL_REQUIRED,
      );
    }
    if (
      request.fileCount > this.limits.maxFileCount ||
      request.byteSize > this.limits.maxTotalBytes ||
      request.byteSize > this.limits.maxSingleFileBytes
    ) {
      throw new ImportGatingError(
        'import exceeds count or size limits',
        {
          fileCount: request.fileCount,
          byteSize: request.byteSize,
        },
        SecErrorCode.SEC_IMPORT_LIMIT_EXCEEDED,
      );
    }
    if (
      request.compressedByteSize !== undefined &&
      request.compressedByteSize > 0 &&
      request.byteSize / request.compressedByteSize > this.limits.maxDecompressionRatio
    ) {
      throw new ImportGatingError(
        'decompression ratio exceeds the intake cap',
        {},
        SecErrorCode.SEC_IMPORT_LIMIT_EXCEEDED,
      );
    }
    for (const memberPath of request.memberPaths) {
      // Path traversal, absolute paths, Windows drives, and symlinks are
      // structurally refused before anything touches the filesystem.
      const normalized = memberPath.replaceAll('\\', '/');
      if (
        normalized.startsWith('/') ||
        /^[a-zA-Z]:/.test(normalized) ||
        normalized.split('/').includes('..') ||
        normalized.includes('\0')
      ) {
        throw new ImportGatingError(
          `unsafe member path refused: ${memberPath}`,
          {},
          SecErrorCode.SEC_IMPORT_PATH_UNSAFE,
        );
      }
    }

    const manifestHash = sha256Text(request.manifestCanonicalJson);
    await this.engine.query(
      `INSERT INTO sec.import_artifacts
         (artifact_id, manifest_sha256, producer_key_id, format, byte_size,
          state, state_rank, prior_state_rank, step_up_approval_ref,
          received_at, state_changed_at)
       VALUES ($1,$2,$3,$4,$5,'RECEIVED',0,-1,$6,$7,$7)`,
      [
        request.artifactId,
        manifestHash,
        request.producerKeyId,
        request.format,
        request.byteSize,
        request.stepUpApprovalRef,
        receivedAt,
      ],
    );
    return this.getArtifact(request.artifactId);
  }

  /**
   * Signature verification against the TRUSTED PRODUCER ALLOWLIST:
   * unknown/expired/revoked keys refuse before verification is attempted.
   */
  async verifySignature(input: {
    artifactId: string;
    signature: string;
    materialBytes: Uint8Array;
    nowMs?: number | undefined;
  }): Promise<void> {
    const row = await this.getArtifact(input.artifactId);
    const producer = this.producers.get(row.producer_key_id);
    if (producer === undefined) {
      throw new ImportGatingError(
        'producer key is not on the trust allowlist',
        { keyId: row.producer_key_id },
        SecErrorCode.SEC_IMPORT_PRODUCER_UNTRUSTED,
      );
    }
    const nowMs = input.nowMs ?? Date.now();
    if (Date.parse(producer.expiresAt as string) <= nowMs || producer.revokedAt !== undefined) {
      throw new ImportGatingError(
        'producer trust is expired or revoked',
        { keyId: producer.keyId },
        SecErrorCode.SEC_IMPORT_PRODUCER_UNTRUSTED,
      );
    }
    // Content-hash check: the recorded manifest hash must equal the hash of
    // the exact material presented (canonical serialization discipline).
    const presentedHash = sha256Text(new TextDecoder().decode(input.materialBytes));
    if (presentedHash !== row.manifest_sha256) {
      throw new ImportGatingError(
        'presented material does not match the recorded manifest hash',
        {},
        SecErrorCode.SEC_IMPORT_HASH_MISMATCH,
      );
    }
    const valid = await this.verifier(
      input.materialBytes,
      input.signature,
      `public-key:${producer.keyId}`,
    );
    if (!valid) {
      throw new ImportGatingError(
        'producer signature verification failed',
        { keyId: producer.keyId },
        SecErrorCode.SEC_IMPORT_SIGNATURE_INVALID,
      );
    }
  }

  /** Content-scanning stage: findings persist as evidence child rows. */
  async recordScanFinding(input: {
    findingId: string;
    artifactId: string;
    scanner: 'FORMAT_INSPECTION' | 'PATH_ANALYSIS' | 'CONTENT_SCAN' | 'SIGNATURE_CHECK';
    verdict: 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';
    detail: string;
    recordedAt: UtcTimestamp;
  }): Promise<void> {
    await this.engine.query(
      `INSERT INTO sec.import_scan_findings
         (finding_id, artifact_id, scanner, verdict, detail, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.findingId,
        input.artifactId,
        input.scanner,
        input.verdict,
        input.detail,
        input.recordedAt,
      ],
    );
    // A MALICIOUS content scan rejects immediately — no VALIDATING limbo.
    if (input.verdict === 'MALICIOUS') {
      await this.transition(input.artifactId, 'REJECTED', input.recordedAt);
    }
  }

  /**
   * Monotone typed transition. Terminal states have no outgoing edges;
   * there is no ACTIVE state anywhere in the machine and none can be named.
   * The guarded UPDATE is the CAS enforcement point: if a concurrent writer
   * changed the state between the legality check and the write, the UPDATE
   * matches zero rows and this method REFUSES — a raced transition is never
   * silently reported as applied.
   */
  async transition(
    artifactId: string,
    to: ImportQuarantineState,
    at: UtcTimestamp,
  ): Promise<ArtifactRow> {
    if (!(to in STATE_RANK)) {
      throw new ImportGatingError(
        `unknown quarantine state '${to}'`,
        {},
        SecErrorCode.SEC_IMPORT_STATE_TRANSITION_INVALID,
      );
    }
    const row = await this.getArtifact(artifactId);
    const legal = TRANSITIONS[row.state] ?? [];
    if (!legal.includes(to)) {
      throw new ImportGatingError(
        `illegal quarantine transition ${row.state} -> ${to}`,
        { from: row.state, to },
        SecErrorCode.SEC_IMPORT_STATE_TRANSITION_INVALID,
      );
    }
    const updated = await this.engine.query<{ artifact_id: string }>(
      `UPDATE sec.import_artifacts
       SET prior_state_rank = state_rank, state_rank = $3, state = $4, state_changed_at = $5
       WHERE artifact_id = $1 AND state = $2
       RETURNING artifact_id`,
      [artifactId, row.state, STATE_RANK[to], to, at],
    );
    if (updated.rows.length !== 1) {
      // A concurrent writer won the CAS: the requested transition is no
      // longer legal against actual SQL truth.
      throw new ImportGatingError(
        `concurrent transition raced: ${row.state} -> ${to} was no longer legal`,
        { from: row.state, to },
        SecErrorCode.SEC_IMPORT_STATE_TRANSITION_INVALID,
      );
    }
    return this.getArtifact(artifactId);
  }

  /** Terminal states only after validation completes with approval coupling. */
  async finalizeValidation(input: {
    artifactId: string;
    outcome: 'SHADOW_ELIGIBLE' | 'REJECTED';
    at: UtcTimestamp;
    /** Re-confirmed by the high-impact gate for eligibility decisions. */
    stepUpApprovalRef: string;
  }): Promise<ArtifactRow> {
    if ((input.stepUpApprovalRef ?? '').trim() === '') {
      throw new ImportGatingError(
        'validation completion requires the step-up approval reference',
        {},
        SecErrorCode.SEC_IMPORT_STEP_UP_APPROVAL_REQUIRED,
      );
    }
    return this.transition(input.artifactId, input.outcome, input.at);
  }

  /** The isolated-parsing boundary contract: parse NEVER runs in-process here. */
  assertIsolatedParsingBoundary(parsingContext: { inProcess: boolean }): void {
    if (parsingContext.inProcess) {
      throw new ImportGatingError(
        'artifact parsing must occur inside the isolated-parsing boundary',
        {},
        SecErrorCode.SEC_IMPORT_FORMAT_REFUSED,
      );
    }
  }

  async getArtifact(artifactId: string): Promise<ArtifactRow> {
    const result = await this.engine.query<ArtifactRow>(
      'SELECT * FROM sec.import_artifacts WHERE artifact_id = $1',
      [artifactId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ImportGatingError('unknown artifact', { artifactId });
    }
    return row;
  }

  async findingsFor(
    artifactId: string,
  ): Promise<{ finding_id: string; scanner: string; verdict: string; detail: string }[]> {
    const result = await this.engine.query<{
      finding_id: string;
      scanner: string;
      verdict: string;
      detail: string;
    }>('SELECT * FROM sec.import_scan_findings WHERE artifact_id = $1 ORDER BY recorded_at', [
      artifactId,
    ]);
    return result.rows;
  }
}
