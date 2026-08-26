/**
 * Package-local provider-lifecycle error vocabulary (FR-PROV-001…010; plan
 * material decision 9). Every gate in this package refuses fail-closed with
 * ONE of these stable machine codes so callers and telemetry branch on
 * `code`, never on prose. Values never change once released; new refusals
 * add new codes.
 *
 * Relationship to `@foresift/domain`: these classes live beside — not
 * inside — the domain ErrorCode because that file is outside this package's
 * binding write scopes. They MIRROR the domain `ForesiftError` SHAPE
 * (code/detail/message contract) exactly like the established
 * `ForesiftSecurityError` precedent in @foresift/security rather than
 * extending it: narrowing `code` from `ErrorCode` down to `ProvErrorCode`
 * in a subclass is not type-sound without widening the domain base class.
 * Callers narrow with {@link isProviderLifecycleError}.
 */

/** Stable machine-readable provider-lifecycle error codes (values never change). */
export const ProvErrorCode = {
  // --- operation registry (FR-PROV-001/004)
  PROV_OPERATION_UNKNOWN: 'PROV_OPERATION_UNKNOWN',
  PROV_OPERATION_ALREADY_REGISTERED: 'PROV_OPERATION_ALREADY_REGISTERED',
  PROV_CAPABILITY_CLASS_PROHIBITED: 'PROV_CAPABILITY_CLASS_PROHIBITED',
  PROV_CAPABILITY_CLASS_UNKNOWN: 'PROV_CAPABILITY_CLASS_UNKNOWN',
  PROV_DEFINITION_INVALID: 'PROV_DEFINITION_INVALID',
  PROV_PROVIDER_UNKNOWN: 'PROV_PROVIDER_UNKNOWN',
  // --- lifecycle transitions (FR-PROV-001, §12.11)
  PROV_LIFECYCLE_TRANSITION_ILLEGAL: 'PROV_LIFECYCLE_TRANSITION_ILLEGAL',
  PROV_LIFECYCLE_REASON_REQUIRED: 'PROV_LIFECYCLE_REASON_REQUIRED',
  PROV_LIFECYCLE_STATE_UNKNOWN: 'PROV_LIFECYCLE_STATE_UNKNOWN',
  PROV_LIFECYCLE_IDEMPOTENCY_CONFLICT: 'PROV_LIFECYCLE_IDEMPOTENCY_CONFLICT',
  PROV_LIFECYCLE_EVENT_IMMUTABLE: 'PROV_LIFECYCLE_EVENT_IMMUTABLE',
  // --- verification TTLs (FR-PROV-002; AC-270)
  PROV_VERIFICATION_TTL_UNCONFIGURED: 'PROV_VERIFICATION_TTL_UNCONFIGURED',
  PROV_VERIFICATION_EXPIRED: 'PROV_VERIFICATION_EXPIRED',
  PROV_VERIFICATION_RECORD_INVALID: 'PROV_VERIFICATION_RECORD_INVALID',
  PROV_REFRESH_PAIR_INCOMPLETE: 'PROV_REFRESH_PAIR_INCOMPLETE',
  // --- deprecation rules (FR-PROV-003/007)
  PROV_DEPRECATED_REGISTRATION_REFUSED: 'PROV_DEPRECATED_REGISTRATION_REFUSED',
  PROV_SOLE_CRITICAL_SOURCE_REFUSED: 'PROV_SOLE_CRITICAL_SOURCE_REFUSED',
  PROV_SUNSET_INCIDENT_REQUIRED: 'PROV_SUNSET_INCIDENT_REQUIRED',
  PROV_STRICT_FREE_UNAVAILABLE: 'PROV_STRICT_FREE_UNAVAILABLE',
  // --- migration exceptions (FR-PROV-003)
  PROV_MIGRATION_EXCEPTION_EXPIRED: 'PROV_MIGRATION_EXCEPTION_EXPIRED',
  PROV_MIGRATION_EXCEPTION_REVOKED: 'PROV_MIGRATION_EXCEPTION_REVOKED',
  PROV_MIGRATION_EXCEPTION_UNKNOWN: 'PROV_MIGRATION_EXCEPTION_UNKNOWN',
  PROV_MIGRATION_EXCEPTION_WINDOW_INVALID: 'PROV_MIGRATION_EXCEPTION_WINDOW_INVALID',
  // --- adapter registration & allowlist enforcement (FR-PROV-004/005)
  PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED: 'PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED',
  PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING: 'PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING',
  PROV_ALLOWLIST_DIMENSION_UNDECLARED: 'PROV_ALLOWLIST_DIMENSION_UNDECLARED',
  PROV_REQUEST_FIELD_NOT_DECLARED: 'PROV_REQUEST_FIELD_NOT_DECLARED',
  PROV_RESPONSE_SCHEMA_DRIFT: 'PROV_RESPONSE_SCHEMA_DRIFT',
  PROV_RESPONSE_BYTES_EXCEEDED: 'PROV_RESPONSE_BYTES_EXCEEDED',
  PROV_RESPONSE_CONTENT_TYPE_REFUSED: 'PROV_RESPONSE_CONTENT_TYPE_REFUSED',
  PROV_REDIRECT_POLICY_REFUSED: 'PROV_REDIRECT_POLICY_REFUSED',
  PROV_DNS_POLICY_REFUSED: 'PROV_DNS_POLICY_REFUSED',
  // --- response quarantine (FR-PROV-008; AC-271)
  PROV_RESPONSE_QUARANTINED: 'PROV_RESPONSE_QUARANTINED',
  PROV_QUARANTINE_PAYLOAD_PERSISTENCE_REFUSED: 'PROV_QUARANTINE_PAYLOAD_PERSISTENCE_REFUSED',
  PROV_TRANSACTION_BUILDING_FIELD_STRIPPED: 'PROV_TRANSACTION_BUILDING_FIELD_STRIPPED',
  // --- rights matrix & artifacts (FR-PROV-009; AC-273)
  PROV_RIGHTS_USE_PATH_PROHIBITED: 'PROV_RIGHTS_USE_PATH_PROHIBITED',
  PROV_RIGHTS_VERSION_UNKNOWN: 'PROV_RIGHTS_VERSION_UNKNOWN',
  PROV_RIGHTS_VERIFICATION_EXPIRED: 'PROV_RIGHTS_VERIFICATION_EXPIRED',
  PROV_RIGHTS_REACTIVATION_REVERIFICATION_REQUIRED:
    'PROV_RIGHTS_REACTIVATION_REVERIFICATION_REQUIRED',
  PROV_ARTIFACT_AFFECTED_RETENTION_REFUSED: 'PROV_ARTIFACT_AFFECTED_RETENTION_REFUSED',
  // --- source fingerprints (FR-PROV-010)
  PROV_FINGERPRINT_KIND_UNKNOWN: 'PROV_FINGERPRINT_KIND_UNKNOWN',
  PROV_FINGERPRINT_PAYLOAD_NOT_CANONICAL: 'PROV_FINGERPRINT_PAYLOAD_NOT_CANONICAL',
  // --- activation readiness (AC-272)
  PROV_READINESS_BLOCKED: 'PROV_READINESS_BLOCKED',
} as const;

export type ProvErrorCode = (typeof ProvErrorCode)[keyof typeof ProvErrorCode];

/** Context carried alongside a machine code (never secrets, never payloads). */
export type ProvErrorDetail = Readonly<Record<string, string | number | boolean | null>>;

function provSubclass(
  name: string,
  defaultCode: ProvErrorCode,
): new (
  message: string,
  detail?: ProvErrorDetail,
  code?: ProvErrorCode,
  options?: ErrorOptions,
) => ProviderLifecycleError {
  return class extends ProviderLifecycleError {
    constructor(
      message: string,
      detail: ProvErrorDetail = {},
      code: ProvErrorCode = defaultCode,
      options?: ErrorOptions,
    ) {
      super(code, message, detail, options);
      this.name = name;
    }
  };
}

/**
 * Base class for every provider-lifecycle refusal. Mirrors the domain
 * `ForesiftError` shape (see the file header for why it does not extend it)
 * while callers additionally narrow on `ProvErrorCode` values. Carries the
 * ES `cause` chain like every repository error class.
 */
export class ProviderLifecycleError extends Error {
  readonly code: ProvErrorCode | string;
  readonly detail: ProvErrorDetail;

  constructor(
    code: ProvErrorCode | string,
    message: string,
    detail: ProvErrorDetail = {},
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'ProviderLifecycleError';
    this.code = code;
    this.detail = detail;
  }
}

/** Operation registry refusals (registration, lookup, definition shape). */
export class RegistryError extends provSubclass('RegistryError', ProvErrorCode.PROV_OPERATION_UNKNOWN) {}
/** Lifecycle-transition refusals (illegal edge, missing reason, dedupe conflicts). */
export class LifecycleTransitionError extends provSubclass(
  'LifecycleTransitionError',
  ProvErrorCode.PROV_LIFECYCLE_TRANSITION_ILLEGAL,
) {}
/** Verification-TTL refusals (unconfigured TTLs, expiry, incomplete refresh pairs). */
export class VerificationTtlError extends provSubclass(
  'VerificationTtlError',
  ProvErrorCode.PROV_VERIFICATION_EXPIRED,
) {}
/** Deprecation-rule refusals (new dependency on deprecated ops, sole critical source). */
export class DeprecationError extends provSubclass(
  'DeprecationError',
  ProvErrorCode.PROV_DEPRECATED_REGISTRATION_REFUSED,
) {}
/** Migration-exception refusals (expired/revoked windows authorize nothing). */
export class MigrationExceptionError extends provSubclass(
  'MigrationExceptionError',
  ProvErrorCode.PROV_MIGRATION_EXCEPTION_EXPIRED,
) {}
/** Adapter registration + allowlist enforcement refusals (deny-by-default). */
export class AdapterRegistrationError extends provSubclass(
  'AdapterRegistrationError',
  ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED,
) {}
/** Response-quarantine refusals (malicious classes; payload persistence). */
export class QuarantineError extends provSubclass(
  'QuarantineError',
  ProvErrorCode.PROV_RESPONSE_QUARANTINED,
) {}
/** Rights-matrix / artifact-registry refusals (fail-closed use decisions). */
export class RightsChangeError extends provSubclass(
  'RightsChangeError',
  ProvErrorCode.PROV_RIGHTS_USE_PATH_PROHIBITED,
) {}
/** Source-fingerprint capture refusals. */
export class FingerprintError extends provSubclass(
  'FingerprintError',
  ProvErrorCode.PROV_FINGERPRINT_KIND_UNKNOWN,
) {}
/** Activation-readiness refusals (BLOCKED carries typed reasons). */
export class ReadinessRefusalError extends provSubclass(
  'ReadinessRefusalError',
  ProvErrorCode.PROV_READINESS_BLOCKED,
) {}

/** Narrowing guard for provider-lifecycle errors. */
export function isProviderLifecycleError(value: unknown): value is ProviderLifecycleError {
  return value instanceof ProviderLifecycleError;
}
