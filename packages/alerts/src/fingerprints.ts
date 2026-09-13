/**
 * §26.4 fingerprint construction, material-change evaluation, and the
 * fingerprint/cooldown ledger (T019, FR-ALERT-001/004, AC-141; PRD §26.4;
 * plan D5).
 *
 * Three responsibilities, each with a hard law:
 * 1. `deriveAlertFingerprint` hashes the domain's byte-stable §26.4 preimage
 *    (`sha256Text(fingerprintOf(input))`) — the hashing boundary stays at the
 *    persistence seam exactly like `computeExactCacheKey` (see
 *    `packages/domain/src/alert.ts`).
 * 2. `evaluateMaterialChange`/`repeatSuppressionDecision` answer "may this
 *    repeat be delivered?" against the ACTIVE per-class thresholds: severity,
 *    thesis, or material evidence must change beyond threshold, and the
 *    duplicate → cooldown → immaterial → ALLOW precedence is fixed so a replay
 *    can never slip past a recorded cooldown.
 * 3. `readAlertFingerprint`/`upsertAlertFingerprint` own the mutable
 *    `alert.alert_fingerprints` ledger. The write is guarded: a regressive
 *    (older) ledger write updates zero rows and refuses with a typed error
 *    rather than silently rewinding the cooldown window.
 *
 * Strictly read-only: fingerprints only decide whether intelligence may be
 * delivered; nothing here can trade, hold custody, sign, handle private keys, or
 * submit a transaction.
 */
import {
  ErrorCode,
  ForesiftError,
  FingerprintOutcome,
  compareTimestamps,
  fingerprintOf,
  utcTimestamp,
  type AlertClass,
  type AlertFingerprintInput,
  type AlertMaterialChangeThresholds,
  type AlertMaterialState,
} from '@foresift/domain';
import { parseAlertSchema, type AlertFingerprintRow } from '@foresift/shared-schemas';
import { sha256Text, type DatabaseEngine } from '@foresift/persistence';
import { alertPolicyFor, type AlertPolicy } from './policies.ts';

/** Version tag of the canonical §26.4 fingerprint content address. */
export const ALERT_FINGERPRINT_VERSION = 'alert-fingerprint:v1' as const;

const CONTENT_ADDRESS_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** True when `value` is already a `sha256:<64hex>` content address. */
export function isContentAddress(value: string): boolean {
  return typeof value === 'string' && CONTENT_ADDRESS_PATTERN.test(value);
}

/**
 * Map an arbitrary material-evidence fingerprint onto the ledger's content
 * address column. An existing `sha256:<hex>` is preserved verbatim (so the
 * ledger key equals the value callers already carry); any other identifier is
 * content-addressed with `sha256Text`, preserving equality exactly.
 */
export function materialEvidenceContentAddress(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ForesiftError(
      ErrorCode.ALERT_FINGERPRINT_INPUT_INVALID,
      'material evidence fingerprint must be a non-empty string',
      { value: null },
    );
  }
  return isContentAddress(value) ? value : sha256Text(value);
}

// --- fingerprint construction -----------------------------------------------

export interface AlertFingerprintKey {
  /** The canonical §26.4 preimage (see `packages/domain/src/alert.ts`). */
  readonly fingerprintPreimage: string;
  /** `sha256:<64hex>` content address over the preimage. */
  readonly fingerprintHash: string;
}

/**
 * Derive the §26.4 fingerprint content address. The domain package returns the
 * byte-stable preimage; the persistence seam owns the hash, exactly like
 * `computeExactCacheKey`. The result is the idempotency anchor for the alert.
 */
export function deriveAlertFingerprint(input: AlertFingerprintInput): AlertFingerprintKey {
  const fingerprintPreimage = fingerprintPreimageOf(input);
  return Object.freeze({
    fingerprintPreimage,
    fingerprintHash: sha256Text(fingerprintPreimage),
  });
}

/** The §26.4 preimage alone (no hashing); exposed for reconstruction/debugging. */
export function fingerprintPreimageOf(input: AlertFingerprintInput): string {
  // The domain law is the single authority for the field list and encoding.
  return fingerprintOf(input);
}

export interface AlertUpdateKeyInput {
  readonly priorAlertRef: string;
  readonly updateKind: string;
  readonly fingerprintHash: string;
  readonly thesisVersion: number;
}

/**
 * Deterministic update/cancellation idempotency key over the canonical
 * `(prior_alert, update_kind, fingerprint, thesis_version)` tuple (plan D5).
 * A replay of the same material event maps to one key.
 */
export function deriveAlertUpdateKey(input: AlertUpdateKeyInput): string {
  const parts = [
    'alert-update:v1',
    `priorAlertRef=${input.priorAlertRef.length}:${input.priorAlertRef}`,
    `updateKind=${input.updateKind}`,
    `fingerprint=${input.fingerprintHash}`,
    `thesisVersion=${input.thesisVersion}`,
  ];
  return sha256Text(parts.join('|'));
}

/** Hex body of a `sha256:<hex>` content address (used to mint deterministic ids). */
export function contentAddressHex(contentAddress: string): string {
  if (!isContentAddress(contentAddress)) {
    throw new ForesiftError(
      ErrorCode.ALERT_FINGERPRINT_INPUT_INVALID,
      'expected a sha256 content address',
      { contentAddress },
    );
  }
  return contentAddress.slice('sha256:'.length);
}

// --- material change --------------------------------------------------------

/**
 * Structured material-change verdict for a prior/next state pair under an
 * explicit threshold set. `changed` is the §26.4 eligibility answer; the
 * component flags keep the reason observable (never prose).
 */
export interface MaterialChangeVerdict {
  readonly changed: boolean;
  readonly classChanged: boolean;
  readonly severityChanged: boolean;
  readonly thesisChanged: boolean;
  readonly materialEvidenceChanged: boolean;
}

function assertUnitInterval(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ForesiftError(ErrorCode.ALERT_MATERIAL_STATE_INVALID, `${field} must lie in [0,1]`, {
      field,
      value: Number.isFinite(value) ? value : null,
    });
  }
  return value;
}

function assertNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ForesiftError(
      ErrorCode.ALERT_MATERIAL_STATE_INVALID,
      `${field} must be a non-negative integer`,
      { field, value: Number.isFinite(value) ? value : null },
    );
  }
  return value;
}

function assertNonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ForesiftError(
      ErrorCode.ALERT_MATERIAL_STATE_INVALID,
      `${field} must be a non-empty string`,
      { field, value: null },
    );
  }
  return value;
}

/** The active thresholds for a class: persisted policy when supplied, else default. */
export function thresholdsFor(
  alertClass: AlertClass,
  policy?: AlertPolicy,
): AlertMaterialChangeThresholds {
  if (policy !== undefined) {
    if (policy.alertClass !== alertClass) {
      throw new ForesiftError(
        ErrorCode.ALERT_POLICY_UNKNOWN,
        'material-change policy class does not match the compared alert class',
        { alertClass, policyClass: policy.alertClass },
      );
    }
    return policy.thresholds;
  }
  // The domain default registry is the total fallback (zero runtime deps).
  return defaultThresholdsFor(alertClass);
}

function defaultThresholdsFor(alertClass: AlertClass): AlertMaterialChangeThresholds {
  return alertPolicyFor(alertClass).thresholds;
}

/**
 * §26.4 repeat law against an explicit threshold set: a repeat is material when
 * severity, thesis, or material evidence changes beyond the per-class
 * thresholds. A class change is always material (it is a different alert).
 */
export function evaluateMaterialChange(
  prior: AlertMaterialState,
  next: AlertMaterialState,
  thresholds: AlertMaterialChangeThresholds,
): MaterialChangeVerdict {
  const priorSeverity = assertUnitInterval(prior.severity, 'prior.severity');
  const nextSeverity = assertUnitInterval(next.severity, 'next.severity');
  const priorThesis = assertNonNegativeInteger(prior.thesisVersion, 'prior.thesisVersion');
  const nextThesis = assertNonNegativeInteger(next.thesisVersion, 'next.thesisVersion');
  const priorEvidence = assertNonEmpty(
    prior.materialEvidenceFingerprint,
    'prior.materialEvidenceFingerprint',
  );
  const nextEvidence = assertNonEmpty(
    next.materialEvidenceFingerprint,
    'next.materialEvidenceFingerprint',
  );

  const classChanged = prior.alertClass !== next.alertClass;
  const severityChanged = Math.abs(nextSeverity - priorSeverity) >= thresholds.severityDelta;
  const thesisChanged = Math.abs(nextThesis - priorThesis) >= thresholds.thesisVersionDelta;
  const materialEvidenceChanged =
    nextEvidence !== priorEvidence && thresholds.materialEvidenceChangeIsMaterial;

  return Object.freeze({
    changed: classChanged || severityChanged || thesisChanged || materialEvidenceChanged,
    classChanged,
    severityChanged,
    thesisChanged,
    materialEvidenceChanged,
  });
}

/**
 * Deterioration is directional: a severity INCREASE is an improvement, not a
 * deterioration, even when the raw material threshold is crossed. A class
 * change or a severity drop/thesis/evidence change beyond threshold is
 * deterioration.
 */
export function isMaterialDeterioration(
  prior: AlertMaterialState,
  next: AlertMaterialState,
  thresholds: AlertMaterialChangeThresholds,
): boolean {
  const verdict = evaluateMaterialChange(prior, next, thresholds);
  if (verdict.classChanged) return true;
  if (next.severity > prior.severity) return false;
  return verdict.changed;
}

// --- repeat suppression decision --------------------------------------------

export interface RepeatSuppressionInput {
  /** The resolved per-class policy (active thresholds + cooldown). */
  readonly policy?: AlertPolicy;
  /** Explicit thresholds; defaults to the class policy's. */
  readonly thresholds?: AlertMaterialChangeThresholds;
  /** Prior material state under this fingerprint, or null when none exists. */
  readonly prior: AlertMaterialState | null;
  readonly next: AlertMaterialState;
  /** End of the recorded cooldown window, or null when none is recorded. */
  readonly cooldownUntil: string | null;
  readonly now: string;
  /** True when the ledger already holds a row for this fingerprint. */
  readonly duplicateFingerprint: boolean;
}

/**
 * Deterministic §26.4 repeat verdict with a fixed precedence:
 * duplicate → cooldown → immaterial → ALLOW. Only ALLOW may reach the
 * transactional commit boundary.
 */
export function repeatSuppressionDecision(input: RepeatSuppressionInput): FingerprintOutcome {
  if (input.duplicateFingerprint) return FingerprintOutcome.SUPPRESS_DUPLICATE;
  if (input.cooldownUntil !== null) {
    const until = utcTimestamp(input.cooldownUntil);
    const at = utcTimestamp(input.now);
    if (compareTimestamps(at, until) < 0) return FingerprintOutcome.SUPPRESS_COOLDOWN;
  }
  if (input.prior !== null) {
    const thresholds = input.thresholds ?? thresholdsFor(input.next.alertClass, input.policy);
    if (!evaluateMaterialChange(input.prior, input.next, thresholds).changed) {
      return FingerprintOutcome.SUPPRESS_IMMATERIAL;
    }
  }
  return FingerprintOutcome.ALLOW;
}

// --- fingerprint/cooldown ledger --------------------------------------------

/** One ledger advance: the delivered state and the resulting cooldown window. */
export interface AlertFingerprintLedgerInput {
  readonly fingerprint: string;
  readonly alertClass: AlertClass;
  readonly lastAlertId: string;
  readonly lastSeverity: number;
  readonly lastThesisVersion: number;
  readonly lastMaterialEvidenceFingerprint: string;
  readonly lastDeliveredAt: string | null;
  readonly cooldownUntil: string;
  readonly updatedAt: string;
}

const SELECT_FINGERPRINT = `
    SELECT fingerprint, alert_class, last_alert_id, last_severity,
           last_thesis_version, last_material_evidence_hash, last_delivered_at,
           cooldown_until, updated_at
      FROM alert.alert_fingerprints
     WHERE fingerprint = $1`;

const UPSERT_FINGERPRINT = `
    INSERT INTO alert.alert_fingerprints
        (fingerprint, alert_class, last_alert_id, last_severity,
         last_thesis_version, last_material_evidence_hash, last_delivered_at,
         cooldown_until, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (fingerprint) DO UPDATE SET
        alert_class = EXCLUDED.alert_class,
        last_alert_id = EXCLUDED.last_alert_id,
        last_severity = EXCLUDED.last_severity,
        last_thesis_version = EXCLUDED.last_thesis_version,
        last_material_evidence_hash = EXCLUDED.last_material_evidence_hash,
        last_delivered_at = EXCLUDED.last_delivered_at,
        cooldown_until = EXCLUDED.cooldown_until,
        updated_at = EXCLUDED.updated_at
      WHERE EXCLUDED.updated_at >= alert.alert_fingerprints.updated_at
    RETURNING fingerprint, alert_class, last_alert_id, last_severity,
              last_thesis_version, last_material_evidence_hash, last_delivered_at,
              cooldown_until, updated_at`;

interface RawFingerprintRow {
  readonly fingerprint: string;
  readonly alert_class: string;
  readonly last_alert_id: string;
  readonly last_severity: number;
  readonly last_thesis_version: number;
  readonly last_material_evidence_hash: string;
  readonly last_delivered_at: string | null;
  readonly cooldown_until: string;
  readonly updated_at: string;
}

function ledgerRowFromRaw(row: RawFingerprintRow): AlertFingerprintRow {
  return parseAlertSchema('AlertFingerprintRow', {
    fingerprint: row.fingerprint,
    alertClass: row.alert_class,
    lastAlertId: row.last_alert_id,
    lastSeverity: row.last_severity,
    lastThesisVersion: row.last_thesis_version,
    lastMaterialEvidenceHash: row.last_material_evidence_hash,
    lastDeliveredAt: row.last_delivered_at,
    cooldownUntil: row.cooldown_until,
    updatedAt: row.updated_at,
  });
}

/** Read the ledger row for one fingerprint, or null when none exists. */
export async function readAlertFingerprint(
  engine: DatabaseEngine,
  fingerprint: string,
): Promise<AlertFingerprintRow | null> {
  const result = await engine.query<RawFingerprintRow>(SELECT_FINGERPRINT, [fingerprint]);
  const row = result.rows[0];
  return row === undefined ? null : ledgerRowFromRaw(row);
}

/**
 * Advance the fingerprint/cooldown ledger. The write is guarded by
 * `updated_at`: a write older than the persisted row updates zero rows and
 * refuses with `CONTRACT_INVARIANT_VIOLATED`, so a stale worker can never
 * rewind a cooldown window.
 */
export async function upsertAlertFingerprint(
  engine: DatabaseEngine,
  input: AlertFingerprintLedgerInput,
): Promise<AlertFingerprintRow> {
  if (!isContentAddress(input.fingerprint)) {
    throw new ForesiftError(
      ErrorCode.ALERT_FINGERPRINT_INPUT_INVALID,
      'alert fingerprint ledger key must be a sha256 content address',
      { fingerprint: input.fingerprint },
    );
  }
  const result = await engine.query<RawFingerprintRow>(UPSERT_FINGERPRINT, [
    input.fingerprint,
    input.alertClass,
    input.lastAlertId,
    input.lastSeverity,
    input.lastThesisVersion,
    materialEvidenceContentAddress(input.lastMaterialEvidenceFingerprint),
    input.lastDeliveredAt,
    input.cooldownUntil,
    input.updatedAt,
  ]);
  const row = result.rows[0];
  if (row === undefined) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'alert fingerprint ledger write is stale and was refused',
      { fingerprint: input.fingerprint, updatedAt: input.updatedAt },
    );
  }
  return ledgerRowFromRaw(row);
}

/** ISO instant `seconds` after `from`; the per-class cooldown window end. */
export function cooldownUntilFrom(from: string, cooldownSeconds: number): string {
  const base = Date.parse(from);
  if (Number.isNaN(base)) {
    throw new ForesiftError(
      ErrorCode.ALERT_FINGERPRINT_INPUT_INVALID,
      'cooldown base is not a timestamp',
      { from },
    );
  }
  if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0) {
    throw new ForesiftError(
      ErrorCode.ALERT_POLICY_UNKNOWN,
      'cooldown seconds must be a non-negative integer',
      { cooldownSeconds: Number.isFinite(cooldownSeconds) ? cooldownSeconds : null },
    );
  }
  return new Date(base + cooldownSeconds * 1_000).toISOString();
}
