/**
 * Package-local provider-lifecycle error vocabulary (FR-PROV-001…010; plan
 * material decision 9). Every gate in the truth engine refuses fail-closed
 * with ONE of these stable machine codes so callers and telemetry branch on
 * `code`, never on prose. Values never change once released; new refusals add
 * new codes.
 *
 * Relationship to `@foresift/domain` and `@foresift/security`: these classes
 * live beside — not inside — the domain ErrorCode because that file is outside
 * this package's binding write scopes. They MIRROR the domain `ForesiftError`
 * SHAPE (code/detail/message contract) exactly like the security package's
 * `SecErrorCode` precedent rather than extending it: narrowing `code` in a
 * subclass is not type-sound without widening the domain base class itself.
 * Callers narrow with {@link isForesiftProviderError}.
 */

/** Stable machine-readable provider-lifecycle error codes (values never change). */
export const ProvErrorCode = {
  // --- operation registry (FR-PROV-001, FR-PROV-004)
  PROV_PROVIDER_ALREADY_REGISTERED: 'PROV_PROVIDER_ALREADY_REGISTERED',
  PROV_PROVIDER_UNKNOWN: 'PROV_PROVIDER_UNKNOWN',
  PROV_OPERATION_ALREADY_REGISTERED: 'PROV_OPERATION_ALREADY_REGISTERED',
  PROV_OPERATION_UNKNOWN: 'PROV_OPERATION_UNKNOWN',
  PROV_CAPABILITY_CLASS_PROHIBITED: 'PROV_CAPABILITY_CLASS_PROHIBITED',
  PROV_CAPABILITY_CLASS_UNKNOWN: 'PROV_CAPABILITY_CLASS_UNKNOWN',
  PROV_DEFINITION_SCHEMA_INVALID: 'PROV_DEFINITION_SCHEMA_INVALID',
  PROV_DEPENDENCY_UNKNOWN: 'PROV_DEPENDENCY_UNKNOWN',
  PROV_DEPENDENCY_ALREADY_REGISTERED: 'PROV_DEPENDENCY_ALREADY_REGISTERED',
  // --- lifecycle machine (FR-PROV-001, §12.11)
  PROV_LIFECYCLE_TRANSITION_ILLEGAL: 'PROV_LIFECYCLE_TRANSITION_ILLEGAL',
  PROV_LIFECYCLE_REASON_REQUIRED: 'PROV_LIFECYCLE_REASON_REQUIRED',
  PROV_LIFECYCLE_STATE_CONFLICT: 'PROV_LIFECYCLE_STATE_CONFLICT',
  PROV_LIFECYCLE_EVENT_IMMUTABLE: 'PROV_LIFECYCLE_EVENT_IMMUTABLE',
  // --- verification TTLs (FR-PROV-002, §15.4 rule 3/4, AC-270)
  PROV_VERIFICATION_TTL_UNCONFIGURED: 'PROV_VERIFICATION_TTL_UNCONFIGURED',
  PROV_VERIFICATION_RECORD_INVALID: 'PROV_VERIFICATION_RECORD_INVALID',
  PROV_VERIFICATION_NOT_FRESH: 'PROV_VERIFICATION_NOT_FRESH',
  PROV_VERIFICATION_REFRESH_INCOMPLETE: 'PROV_VERIFICATION_REFRESH_INCOMPLETE',
  // --- deprecation rules (FR-PROV-003, FR-PROV-007, §15.4 rules 1/2/6)
  PROV_DEPRECATED_DEPENDENCY_BLOCKED: 'PROV_DEPRECATED_DEPENDENCY_BLOCKED',
  PROV_DEPRECATED_SOLE_CRITICAL_SOURCE: 'PROV_DEPRECATED_SOLE_CRITICAL_SOURCE',
  PROV_STRICT_FREE_PLAN_UNVERIFIED: 'PROV_STRICT_FREE_PLAN_UNVERIFIED',
  // --- migration exceptions (FR-PROV-003)
  PROV_MIGRATION_EXCEPTION_UNKNOWN: 'PROV_MIGRATION_EXCEPTION_UNKNOWN',
  PROV_MIGRATION_EXCEPTION_WINDOW_INVALID: 'PROV_MIGRATION_EXCEPTION_WINDOW_INVALID',
  PROV_MIGRATION_EXCEPTION_CONFLICT: 'PROV_MIGRATION_EXCEPTION_CONFLICT',
  PROV_MIGRATION_EXCEPTION_EXPIRED: 'PROV_MIGRATION_EXCEPTION_EXPIRED',
  PROV_MIGRATION_EXCEPTION_REVOKED: 'PROV_MIGRATION_EXCEPTION_REVOKED',
  // --- adapter registration (FR-PROV-004, §35.7/§41.1)
  PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED: 'PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED',
  PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING: 'PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING',
  PROV_ADAPTER_OPERATION_UNDECLARED: 'PROV_ADAPTER_OPERATION_UNDECLARED',
  // --- exact allowlist enforcement (FR-PROV-005, AC-257)
  PROV_ALLOWLIST_URL_PARAMETER_REFUSED: 'PROV_ALLOWLIST_URL_PARAMETER_REFUSED',
  PROV_ALLOWLIST_METHOD_REFUSED: 'PROV_ALLOWLIST_METHOD_REFUSED',
  PROV_ALLOWLIST_PATH_TEMPLATE_REFUSED: 'PROV_ALLOWLIST_PATH_TEMPLATE_REFUSED',
  PROV_ALLOWLIST_REQUEST_FIELD_REFUSED: 'PROV_ALLOWLIST_REQUEST_FIELD_REFUSED',
  PROV_ALLOWLIST_REQUEST_CONTENT_TYPE_REFUSED: 'PROV_ALLOWLIST_REQUEST_CONTENT_TYPE_REFUSED',
  PROV_ALLOWLIST_REDIRECT_REFUSED: 'PROV_ALLOWLIST_REDIRECT_REFUSED',
  PROV_ALLOWLIST_RESPONSE_BYTES_EXCEEDED: 'PROV_ALLOWLIST_RESPONSE_BYTES_EXCEEDED',
  PROV_ALLOWLIST_RESPONSE_CONTENT_TYPE_REFUSED: 'PROV_ALLOWLIST_RESPONSE_CONTENT_TYPE_REFUSED',
  PROV_ALLOWLIST_RESPONSE_SCHEMA_REFUSED: 'PROV_ALLOWLIST_RESPONSE_SCHEMA_REFUSED',
  // --- response quarantine (FR-PROV-008, AC-271)
  PROV_RESPONSE_QUARANTINED: 'PROV_RESPONSE_QUARANTINED',
  PROV_QUARANTINE_RECORD_INVALID: 'PROV_QUARANTINE_RECORD_INVALID',
  PROV_QUARANTINE_MODEL_CONTEXT_EXCLUSION_ENFORCED:
    'PROV_QUARANTINE_MODEL_CONTEXT_EXCLUSION_ENFORCED',
  // --- rights matrix / changes (FR-PROV-009, §15.6, AC-273)
  PROV_RIGHTS_MATRIX_INVALID: 'PROV_RIGHTS_MATRIX_INVALID',
  PROV_RIGHTS_VERSION_UNKNOWN: 'PROV_RIGHTS_VERSION_UNKNOWN',
  PROV_RIGHTS_USE_PROHIBITED: 'PROV_RIGHTS_USE_PROHIBITED',
  PROV_RIGHTS_VERIFICATION_EXPIRED: 'PROV_RIGHTS_VERIFICATION_EXPIRED',
  PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION:
    'PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION',
  // --- source fingerprints (FR-PROV-010, §15.7)
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
) => ForesiftProviderError {
  return class extends ForesiftProviderError {
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
export class ForesiftProviderError extends Error {
  readonly code: ProvErrorCode | string;
  readonly detail: ProvErrorDetail;

  constructor(
    code: ProvErrorCode | string,
    message: string,
    detail: ProvErrorDetail = {},
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'ForesiftProviderError';
    this.code = code;
    this.detail = detail;
  }
}

/** Operation/provider registry refusals (registration-time validation). */
export class RegistryError extends provSubclass(
  'RegistryError',
  ProvErrorCode.PROV_OPERATION_UNKNOWN,
) {}
/** Guarded lifecycle-transition refusals (illegal graph edges, missing reasons). */
export class LifecycleTransitionError extends provSubclass(
  'LifecycleTransitionError',
  ProvErrorCode.PROV_LIFECYCLE_TRANSITION_ILLEGAL,
) {}
/** Verification-TTL refusals (unconfigured TTLs, stale verification, partial refresh). */
export class VerificationTtlError extends provSubclass(
  'VerificationTtlError',
  ProvErrorCode.PROV_VERIFICATION_NOT_FRESH,
) {}
/** Deprecation-rule refusals (new dependencies on deprecated ops, sole sources). */
export class DeprecationRuleError extends provSubclass(
  'DeprecationRuleError',
  ProvErrorCode.PROV_DEPRECATED_DEPENDENCY_BLOCKED,
) {}
/** Migration-exception window/refusal semantics (fail-closed, no grace). */
export class MigrationExceptionError extends provSubclass(
  'MigrationExceptionError',
  ProvErrorCode.PROV_MIGRATION_EXCEPTION_EXPIRED,
) {}
/** Adapter-registration refusals (prohibited classes, bundle exposure). */
export class AdapterRegistrationError extends provSubclass(
  'AdapterRegistrationError',
  ProvErrorCode.PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED,
) {}
/** Exact per-adapter allowlist enforcement refusals (deny-by-default dimensions). */
export class AllowlistEnforcementError extends provSubclass(
  'AllowlistEnforcementError',
  ProvErrorCode.PROV_ALLOWLIST_PATH_TEMPLATE_REFUSED,
) {}
/** Malicious-response quarantine refusals (reject/quarantine/audit/exclude). */
export class ResponseQuarantineError extends provSubclass(
  'ResponseQuarantineError',
  ProvErrorCode.PROV_RESPONSE_QUARANTINED,
) {}
/** Rights-matrix change and use-decision refusals (fail-closed paths). */
export class RightsChangeError extends provSubclass(
  'RightsChangeError',
  ProvErrorCode.PROV_RIGHTS_USE_PROHIBITED,
) {}
/** Source-fingerprint capture/storage refusals. */
export class SourceFingerprintError extends provSubclass(
  'SourceFingerprintError',
  ProvErrorCode.PROV_FINGERPRINT_KIND_UNKNOWN,
) {}
/** Activation-readiness refusals consumed by the future workspace/public gate. */
export class ReadinessRefusedError extends provSubclass(
  'ReadinessRefusedError',
  ProvErrorCode.PROV_READINESS_BLOCKED,
) {}

/** Narrowing guard for provider-lifecycle errors. */
export function isForesiftProviderError(value: unknown): value is ForesiftProviderError {
  return value instanceof ForesiftProviderError;
}
