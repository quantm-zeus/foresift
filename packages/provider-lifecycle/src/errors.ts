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
 * (code/detail/message contract) rather than extending it, exactly like the
 * security vocabulary (`SecErrorCode`) does. Callers narrow with
 * {@link isForesiftProviderError}.
 */

/** Stable machine-readable provider-lifecycle error codes (values never change). */
export const ProvErrorCode = {
  // --- registry (FR-PROV-001, FR-PROV-004; §15.3)
  PROV_PROVIDER_UNKNOWN: 'PROV_PROVIDER_UNKNOWN',
  PROV_OPERATION_UNKNOWN: 'PROV_OPERATION_UNKNOWN',
  PROV_OPERATION_VERSION_CONFLICT: 'PROV_OPERATION_VERSION_CONFLICT',
  PROV_DEFINITION_INVALID: 'PROV_DEFINITION_INVALID',
  PROV_CAPABILITY_CLASS_PROHIBITED: 'PROV_CAPABILITY_CLASS_PROHIBITED',
  PROV_COST_CLASS_UNKNOWN: 'PROV_COST_CLASS_UNKNOWN',
  PROV_DEPENDENCY_REGISTRATION_INVALID: 'PROV_DEPENDENCY_REGISTRATION_INVALID',
  // --- lifecycle transitions (FR-PROV-001; §12.11, INV-004/INV-009)
  PROV_STATE_UNKNOWN: 'PROV_STATE_UNKNOWN',
  PROV_TRANSITION_ILLEGAL: 'PROV_TRANSITION_ILLEGAL',
  PROV_TRANSITION_REASON_REQUIRED: 'PROV_TRANSITION_REASON_REQUIRED',
  PROV_IDEMPOTENCY_KEY_CONFLICT: 'PROV_IDEMPOTENCY_KEY_CONFLICT',
  PROV_EVENT_LEDGER_MUTATION_REFUSED: 'PROV_EVENT_LEDGER_MUTATION_REFUSED',
  // --- verification TTLs (FR-PROV-002; §15.4 rules 3/4, AC-270)
  PROV_VERIFICATION_KIND_UNKNOWN: 'PROV_VERIFICATION_KIND_UNKNOWN',
  PROV_VERIFICATION_TTL_UNCONFIGURED: 'PROV_VERIFICATION_TTL_UNCONFIGURED',
  PROV_VERIFICATION_RECORD_INVALID: 'PROV_VERIFICATION_RECORD_INVALID',
  PROV_VERIFICATION_EXPIRED: 'PROV_VERIFICATION_EXPIRED',
  PROV_REFRESH_PAIR_INCOMPLETE: 'PROV_REFRESH_PAIR_INCOMPLETE',
  // --- deprecation (FR-PROV-003, FR-PROV-007; §15.4 rules 1/2/6)
  PROV_DEPRECATED_NEW_USE_BLOCKED: 'PROV_DEPRECATED_NEW_USE_BLOCKED',
  PROV_SOLE_CRITICAL_SOURCE_REFUSED: 'PROV_SOLE_CRITICAL_SOURCE_REFUSED',
  PROV_STRICT_FREE_PLAN_UNPROVEN: 'PROV_STRICT_FREE_PLAN_UNPROVEN',
  // --- migration exceptions (FR-PROV-003)
  PROV_EXCEPTION_WINDOW_INVALID: 'PROV_EXCEPTION_WINDOW_INVALID',
  PROV_EXCEPTION_UNKNOWN: 'PROV_EXCEPTION_UNKNOWN',
  PROV_EXCEPTION_NOT_VALID: 'PROV_EXCEPTION_NOT_VALID',
  // --- adapter registration (FR-PROV-004; §15.2, §41.1)
  PROV_ADAPTER_CATALOG_INVALID: 'PROV_ADAPTER_CATALOG_INVALID',
  PROV_ADAPTER_WHOLESALE_BUNDLE_REFUSED: 'PROV_ADAPTER_WHOLESALE_BUNDLE_REFUSED',
  PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING: 'PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING',
  // --- allowlist enforcement (FR-PROV-005; §35.3 cooperation)
  PROV_ALLOWLIST_DIMENSION_UNDECLARED: 'PROV_ALLOWLIST_DIMENSION_UNDECLARED',
  PROV_ALLOWLIST_METHOD_REFUSED: 'PROV_ALLOWLIST_METHOD_REFUSED',
  PROV_ALLOWLIST_PATH_REFUSED: 'PROV_ALLOWLIST_PATH_REFUSED',
  PROV_ALLOWLIST_CONTENT_TYPE_REFUSED: 'PROV_ALLOWLIST_CONTENT_TYPE_REFUSED',
  PROV_ALLOWLIST_REQUEST_FIELD_REFUSED: 'PROV_ALLOWLIST_REQUEST_FIELD_REFUSED',
  PROV_ALLOWLIST_RESPONSE_SCHEMA_REFUSED: 'PROV_ALLOWLIST_RESPONSE_SCHEMA_REFUSED',
  // --- Helius raw/history + local decoding (FR-PROV-007; §15.8)
  PROV_DECODING_COVERAGE_INCOMPLETE: 'PROV_DECODING_COVERAGE_INCOMPLETE',
  // --- response quarantine (FR-PROV-008; AC-271)
  PROV_MALICIOUS_RESPONSE_REJECTED: 'PROV_MALICIOUS_RESPONSE_REJECTED',
  PROV_QUARANTINE_METADATA_ONLY_REFUSED: 'PROV_QUARANTINE_METADATA_ONLY_REFUSED',
  PROV_QUARANTINE_WRITE_THROUGH_REFUSED: 'PROV_QUARANTINE_WRITE_THROUGH_REFUSED',
  // --- rights matrix & changes (FR-PROV-009; §15.6, AC-273)
  PROV_RIGHTS_DECLARATION_INVALID: 'PROV_RIGHTS_DECLARATION_INVALID',
  PROV_RIGHTS_VERSION_UNKNOWN: 'PROV_RIGHTS_VERSION_UNKNOWN',
  PROV_RIGHTS_USE_PROHIBITED: 'PROV_RIGHTS_USE_PROHIBITED',
  PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION:
    'PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION',
  PROV_RIGHTS_ACTION_INCOMPLETE: 'PROV_RIGHTS_ACTION_INCOMPLETE',
  // --- source fingerprints (FR-PROV-010; §15.7)
  PROV_FINGERPRINT_KIND_UNKNOWN: 'PROV_FINGERPRINT_KIND_UNKNOWN',
  PROV_FINGERPRINT_PAYLOAD_INVALID: 'PROV_FINGERPRINT_PAYLOAD_INVALID',
  // --- activation readiness (AC-272)
  PROV_READINESS_INPUT_INVALID: 'PROV_READINESS_INPUT_INVALID',
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

/** Registry storage/validation refusals (§15.3 definitions, dependencies). */
export class RegistryError extends provSubclass(
  'RegistryError',
  ProvErrorCode.PROV_DEFINITION_INVALID,
) {}
/** Seven-state lifecycle-transition refusals (§12.11 graph, ledger integrity). */
export class LifecycleTransitionError extends provSubclass(
  'LifecycleTransitionError',
  ProvErrorCode.PROV_TRANSITION_ILLEGAL,
) {}
/** Verification-TTL freshness/config/refusal errors (fail-closed). */
export class VerificationTtlError extends provSubclass(
  'VerificationTtlError',
  ProvErrorCode.PROV_VERIFICATION_EXPIRED,
) {}
/** Deprecation-rule refusals (new use blocks, sole-source, STRICT_FREE). */
export class DeprecationError extends provSubclass(
  'DeprecationError',
  ProvErrorCode.PROV_DEPRECATED_NEW_USE_BLOCKED,
) {}
/** Migration-exception window/validity refusals (fail-closed, no grace). */
export class MigrationExceptionError extends provSubclass(
  'MigrationExceptionError',
  ProvErrorCode.PROV_EXCEPTION_NOT_VALID,
) {}
/** Adapter-registration refusals (prohibited classes, bundles, descriptors). */
export class AdapterRegistrationError extends provSubclass(
  'AdapterRegistrationError',
  ProvErrorCode.PROV_ADAPTER_CATALOG_INVALID,
) {}
/** Exact-allowlist enforcement refusals (deny-by-default dimensions). */
export class AllowlistError extends provSubclass(
  'AllowlistError',
  ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
) {}
/** Malicious-response rejection/quarantine refusals. */
export class ResponseQuarantineError extends provSubclass(
  'ResponseQuarantineError',
  ProvErrorCode.PROV_MALICIOUS_RESPONSE_REJECTED,
) {}
/** Rights-declaration/change/use refusals (fail-closed). */
export class RightsChangeError extends provSubclass(
  'RightsChangeError',
  ProvErrorCode.PROV_RIGHTS_USE_PROHIBITED,
) {}
/** Source-fingerprint capture/storage refusals. */
export class FingerprintError extends provSubclass(
  'FingerprintError',
  ProvErrorCode.PROV_FINGERPRINT_KIND_UNKNOWN,
) {}
/** Activation-readiness evaluation input refusals. */
export class ReadinessError extends provSubclass(
  'ReadinessError',
  ProvErrorCode.PROV_READINESS_INPUT_INVALID,
) {}

/** Narrowing guard for provider-lifecycle errors. */
export function isForesiftProviderError(value: unknown): value is ForesiftProviderError {
  return value instanceof ForesiftProviderError;
}
