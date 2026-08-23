/**
 * Typed error classes with stable machine codes (FR-DATA-001…006, FR-DR-001…002).
 *
 * Every refusal in this repository surfaces one of these errors so callers and
 * telemetry can branch on `code` — never on prose. All refusals are fail-closed:
 * there is no error class meaning "guess a default instead".
 */

/** Stable machine-readable error codes. Values never change once released. */
export const ErrorCode = {
  // --- identity (FR-DATA-001)
  IDENTITY_CHAIN_ID_INVALID: 'IDENTITY_CHAIN_ID_INVALID',
  IDENTITY_ADDRESS_INVALID: 'IDENTITY_ADDRESS_INVALID',
  IDENTITY_SYMBOL_IS_NOT_AN_IDENTIFIER: 'IDENTITY_SYMBOL_IS_NOT_AN_IDENTIFIER',
  IDENTITY_EQUIVALENCE_UNVERIFIED: 'IDENTITY_EQUIVALENCE_UNVERIFIED',
  IDENTITY_DECIMALS_CONFLICTING: 'IDENTITY_DECIMALS_CONFLICTING',
  IDENTITY_MIGRATION_EDGE_AMBIGUOUS: 'IDENTITY_MIGRATION_EDGE_AMBIGUOUS',
  IDENTITY_MIGRATION_EDGE_CYCLES: 'IDENTITY_MIGRATION_EDGE_CYCLES',
  // --- quantity (FR-DATA-001 / §11.5)
  QUANTITY_DECIMAL_STRING_INVALID: 'QUANTITY_DECIMAL_STRING_INVALID',
  QUANTITY_SCALE_EXCEEDED: 'QUANTITY_SCALE_EXCEEDED',
  QUANTITY_NEGATIVE_UNSUPPORTED: 'QUANTITY_NEGATIVE_UNSUPPORTED',
  // --- observations/revisions (FR-DATA-002 / §13.4)
  OBSERVATION_IMMUTABLE: 'OBSERVATION_IMMUTABLE',
  REVISION_SUPERSEDES_UNKNOWN: 'REVISION_SUPERSEDES_UNKNOWN',
  REVISION_NOT_LATEST: 'REVISION_NOT_LATEST',
  REORG_COMPENSATION_INVALID: 'REORG_COMPENSATION_INVALID',
  // --- replay/time (FR-DATA-003 / §13.1–13.2, §13.6)
  REPLAY_BOUNDARY_VIOLATION: 'REPLAY_BOUNDARY_VIOLATION',
  AVAILABILITY_PROVENANCE_UNKNOWN: 'AVAILABILITY_PROVENANCE_UNKNOWN',
  AVAILABLE_AT_INFERRED_FROM_EVENT_AT: 'AVAILABLE_AT_INFERRED_FROM_EVENT_AT',
  BACKFILL_BACKDATING_REJECTED: 'BACKFILL_BACKDATING_REJECTED',
  BACKFILL_AVAILABILITY_PROOF_MISSING: 'BACKFILL_AVAILABILITY_PROOF_MISSING',
  WATERMARK_NON_CONTIGUOUS: 'WATERMARK_NON_CONTIGUOUS',
  TIMESTAMP_INVALID: 'TIMESTAMP_INVALID',
  // --- quality (FR-DATA-005 / §13.9)
  QUALITY_CODE_UNKNOWN: 'QUALITY_CODE_UNKNOWN',
  QUALITY_NULL_WITHOUT_CODE: 'QUALITY_NULL_WITHOUT_CODE',
  QUALITY_STATE_REQUIRED: 'QUALITY_STATE_REQUIRED',
  // --- acquisition (§13.8 / AC-242/243)
  ACQUISITION_STATE_UNKNOWN: 'ACQUISITION_STATE_UNKNOWN',
  ACQUISITION_WRITE_BEFORE_RETRIEVAL_VIOLATED: 'ACQUISITION_WRITE_BEFORE_RETRIEVAL_VIOLATED',
  ACQUISITION_PROBE_ASSIGNMENT_MISSING: 'ACQUISITION_PROBE_ASSIGNMENT_MISSING',
  // --- features (FR-DATA-004 / AC-244)
  FEATURE_PROVENANCE_INCOMPLETE: 'FEATURE_PROVENANCE_INCOMPLETE',
  FEATURE_ONLINE_OFFLINE_DIVERGENCE: 'FEATURE_ONLINE_OFFLINE_DIVERGENCE',
  // --- sources/independence (FR-DATA-006 / §11.7, INV-008)
  SOURCE_DEPENDENCE_INPUT_INVALID: 'SOURCE_DEPENDENCE_INPUT_INVALID',
  SOURCE_FROZEN_COUNT_IMMUTABLE: 'SOURCE_FROZEN_COUNT_IMMUTABLE',
  // --- checkpoints/gaps (INV-009, AC-263)
  CHECKPOINT_STALE_FENCING_TOKEN: 'CHECKPOINT_STALE_FENCING_TOKEN',
  CHECKPOINT_CURSOR_REGRESSION: 'CHECKPOINT_CURSOR_REGRESSION',
  COLLECTOR_GAP_UNMARKED: 'COLLECTOR_GAP_UNMARKED',
  CANONICAL_EVENT_DUPLICATE: 'CANONICAL_EVENT_DUPLICATE',
  // --- object store / staged commit (ADR-003, §14.8, FR-DR-002)
  OBJECT_HASH_MISMATCH: 'OBJECT_HASH_MISMATCH',
  OBJECT_RIGHTS_METADATA_MISMATCH: 'OBJECT_RIGHTS_METADATA_MISMATCH',
  OBJECT_STAGE_TRANSITION_INVALID: 'OBJECT_STAGE_TRANSITION_INVALID',
  OBJECT_ORPHAN_DETECTED: 'OBJECT_ORPHAN_DETECTED',
  OBJECT_RETENTION_DRIFT: 'OBJECT_RETENTION_DRIFT',
  // --- recovery/drills (FR-DR-001/002, §34)
  RECOVERY_TIER_CEILING_EXCEEDED: 'RECOVERY_TIER_CEILING_EXCEEDED',
  RESTORE_VERIFICATION_FAILED: 'RESTORE_VERIFICATION_FAILED',
  RESTORE_CREDENTIAL_PROVIDER_MISSING: 'RESTORE_CREDENTIAL_PROVIDER_MISSING',
  BACKUP_KEY_MATERIAL_FORBIDDEN: 'BACKUP_KEY_MATERIAL_FORBIDDEN',
  BACKUP_POLICY_INVALID: 'BACKUP_POLICY_INVALID',
  DRILL_INCIDENT_RECORDED: 'DRILL_INCIDENT_RECORDED',
  // --- generic contract violations
  CONTRACT_INVARIANT_VIOLATED: 'CONTRACT_INVARIANT_VIOLATED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Context carried alongside a machine code (never secrets). */
export type ErrorDetail = Readonly<Record<string, string | number | boolean | null>>;

/** Base class for every refusal this system raises. Fail-closed by construction. */
export class ForesiftError extends Error {
  readonly code: ErrorCode;
  readonly detail: ErrorDetail;

  constructor(code: ErrorCode, message: string, detail: ErrorDetail = {}) {
    super(`${code}: ${message}`);
    this.name = 'ForesiftError';
    this.code = code;
    this.detail = detail;
  }
}

function subclass(
  name: string,
  defaultCode: ErrorCode,
): new (message: string, detail?: ErrorDetail, code?: ErrorCode) => ForesiftError {
  return class extends ForesiftError {
    constructor(message: string, detail: ErrorDetail = {}, code: ErrorCode = defaultCode) {
      super(code, message, detail);
      this.name = name;
    }
  };
}

/** FR-DATA-001 identity refusals. */
export class IdentityError extends subclass(
  'IdentityError',
  ErrorCode.CONTRACT_INVARIANT_VIOLATED,
) {}
/** §11.5 numeric-policy refusals. */
export class QuantityError extends subclass(
  'QuantityError',
  ErrorCode.QUANTITY_DECIMAL_STRING_INVALID,
) {}
/** FR-DATA-002 observation/revision immutability refusals. */
export class ObservationError extends subclass(
  'ObservationError',
  ErrorCode.OBSERVATION_IMMUTABLE,
) {}
/** FR-DATA-003 replay/temporal refusals. */
export class ReplayError extends subclass('ReplayError', ErrorCode.REPLAY_BOUNDARY_VIOLATION) {}
/** FR-DATA-005 quality-code refusals ("null alone is insufficient"). */
export class QualityError extends subclass('QualityError', ErrorCode.QUALITY_CODE_UNKNOWN) {}
/** §13.8 acquisition-contract refusals. */
export class AcquisitionError extends subclass(
  'AcquisitionError',
  ErrorCode.ACQUISITION_STATE_UNKNOWN,
) {}
/** FR-DATA-004 feature-consistency refusals. */
export class FeatureError extends subclass(
  'FeatureError',
  ErrorCode.FEATURE_PROVENANCE_INCOMPLETE,
) {}
/** FR-DATA-006 source-lineage refusals. */
export class SourceError extends subclass(
  'SourceError',
  ErrorCode.SOURCE_DEPENDENCE_INPUT_INVALID,
) {}
/** INV-009 checkpoint/fencing refusals. */
export class CheckpointError extends subclass(
  'CheckpointError',
  ErrorCode.CHECKPOINT_STALE_FENCING_TOKEN,
) {}
/** Object-store / staged-commit refusals. */
export class ObjectStoreError extends subclass(
  'ObjectStoreError',
  ErrorCode.OBJECT_HASH_MISMATCH,
) {}
/** Recovery/backup/restore refusals. */
export class RecoveryError extends subclass(
  'RecoveryError',
  ErrorCode.RESTORE_VERIFICATION_FAILED,
) {}

/** Narrowing guard for Foresift errors. */
export function isForesiftError(value: unknown): value is ForesiftError {
  return value instanceof ForesiftError;
}
