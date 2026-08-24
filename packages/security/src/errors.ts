/**
 * Package-local security error vocabulary (FR-SEC-001…012; plan material
 * decision 3). Every perimeter gate refuses fail-closed with ONE of these
 * stable machine codes so callers and telemetry branch on `code`, never on
 * prose. Values never change once released; new refusals add new codes.
 *
 * These live beside — not inside — `@foresift/domain`'s ErrorCode because that
 * file is outside this package's binding write scopes; the domain generic
 * (`CONTRACT_INVARIANT_VIOLATED`) remains available for cross-cutting cases,
 * and `ForesiftError` itself is still the base class of every refusal here.
 */

/** Stable machine-readable security error codes (values never change). */
export const SecErrorCode = {
  // --- audit integrity (FR-SEC-002, §35.9, AC-259)
  SEC_AUDIT_CHAIN_VERIFICATION_FAILED: 'SEC_AUDIT_CHAIN_VERIFICATION_FAILED',
  SEC_AUDIT_ENTRY_IMMUTABLE: 'SEC_AUDIT_ENTRY_IMMUTABLE',
  SEC_AUDIT_PAYLOAD_NOT_CANONICAL: 'SEC_AUDIT_PAYLOAD_NOT_CANONICAL',
  SEC_AUDIT_CHECKPOINT_MISMATCH: 'SEC_AUDIT_CHECKPOINT_MISMATCH',
  SEC_AUDIT_CATEGORY_UNKNOWN: 'SEC_AUDIT_CATEGORY_UNKNOWN',
  // --- step-up / high-impact action gate (FR-SEC-001, §35.1, AC-274)
  SEC_STEP_UP_PROOF_MISSING: 'SEC_STEP_UP_PROOF_MISSING',
  SEC_STEP_UP_PROOF_STALE: 'SEC_STEP_UP_PROOF_STALE',
  SEC_STEP_UP_AUTHENTICATOR_CLASS_INSUFFICIENT: 'SEC_STEP_UP_AUTHENTICATOR_CLASS_INSUFFICIENT',
  SEC_ACTION_SCOPE_MISMATCH: 'SEC_ACTION_SCOPE_MISMATCH',
  SEC_CSRF_TOKEN_INVALID: 'SEC_CSRF_TOKEN_INVALID',
  SEC_IDEMPOTENCY_KEY_MISSING: 'SEC_IDEMPOTENCY_KEY_MISSING',
  SEC_REASON_ENTRY_MISSING: 'SEC_REASON_ENTRY_MISSING',
  SEC_HIGH_IMPACT_BLOCKED_BY_AUDIT_HEALTH: 'SEC_HIGH_IMPACT_BLOCKED_BY_AUDIT_HEALTH',
  // --- MCP Origin policy (FR-SEC-001, ADR-055, AC-250)
  SEC_ORIGIN_NOT_ALLOWLISTED: 'SEC_ORIGIN_NOT_ALLOWLISTED',
  SEC_ORIGIN_PUNYCODE_CONFUSED: 'SEC_ORIGIN_PUNYCODE_CONFUSED',
  SEC_ORIGIN_TRAILING_DOT: 'SEC_ORIGIN_TRAILING_DOT',
  SEC_ORIGIN_MIXED_SCHEME: 'SEC_ORIGIN_MIXED_SCHEME',
  SEC_ORIGIN_WRONG_PORT: 'SEC_ORIGIN_WRONG_PORT',
  SEC_ORIGIN_WRONG_HOST: 'SEC_ORIGIN_WRONG_HOST',
  SEC_ORIGIN_ABSENT_POLICY_REFUSES: 'SEC_ORIGIN_ABSENT_POLICY_REFUSES',
  SEC_ORIGIN_MALFORMED: 'SEC_ORIGIN_MALFORMED',
  // --- MCP protocol/session guard (FR-SEC-001, ADR-055, AC-251)
  SEC_PROTOCOL_REVISION_UNSUPPORTED: 'SEC_PROTOCOL_REVISION_UNSUPPORTED',
  SEC_CONTENT_TYPE_INVALID: 'SEC_CONTENT_TYPE_INVALID',
  SEC_METHOD_INVALID: 'SEC_METHOD_INVALID',
  SEC_MESSAGE_OVERSIZE: 'SEC_MESSAGE_OVERSIZE',
  SEC_SESSION_BINDING_INVALID: 'SEC_SESSION_BINDING_INVALID',
  SEC_CURSOR_UNAUTHORIZED: 'SEC_CURSOR_UNAUTHORIZED',
  // --- OAuth token binding (FR-SEC-001, ADR-055, AC-253)
  SEC_OAUTH_PKCE_REQUIRED: 'SEC_OAUTH_PKCE_REQUIRED',
  SEC_OAUTH_REDIRECT_URI_MISMATCH: 'SEC_OAUTH_REDIRECT_URI_MISMATCH',
  SEC_OAUTH_AUDIENCE_MISMATCH: 'SEC_OAUTH_AUDIENCE_MISMATCH',
  SEC_OAUTH_TOKEN_EXPIRED: 'SEC_OAUTH_TOKEN_EXPIRED',
  SEC_OAUTH_SCOPE_WIDENED: 'SEC_OAUTH_SCOPE_WIDENED',
  SEC_OAUTH_UPSTREAM_PASSTHROUGH_REFUSED: 'SEC_OAUTH_UPSTREAM_PASSTHROUGH_REFUSED',
  // --- egress control (FR-SEC-004, §35.3, AC-051/AC-257)
  SEC_EGRESS_HOST_NOT_ALLOWLISTED: 'SEC_EGRESS_HOST_NOT_ALLOWLISTED',
  SEC_EGRESS_SCHEME_REFUSED: 'SEC_EGRESS_SCHEME_REFUSED',
  SEC_EGRESS_PORT_UNSAFE: 'SEC_EGRESS_PORT_UNSAFE',
  SEC_EGRESS_ADDRESS_DENIED: 'SEC_EGRESS_ADDRESS_DENIED',
  SEC_EGRESS_RESOLUTION_REFUSED: 'SEC_EGRESS_RESOLUTION_REFUSED',
  SEC_EGRESS_REBINDING_DETECTED: 'SEC_EGRESS_REBINDING_DETECTED',
  SEC_EGRESS_REDIRECT_UNAPPROVED: 'SEC_EGRESS_REDIRECT_UNAPPROVED',
  SEC_EGRESS_REDIRECT_LIMIT_EXCEEDED: 'SEC_EGRESS_REDIRECT_LIMIT_EXCEEDED',
  SEC_EGRESS_RESPONSE_BYTES_EXCEEDED: 'SEC_EGRESS_RESPONSE_BYTES_EXCEEDED',
  SEC_EGRESS_RESPONSE_TIME_EXCEEDED: 'SEC_EGRESS_RESPONSE_TIME_EXCEEDED',
  SEC_EGRESS_DECOMPRESSION_RATIO_EXCEEDED: 'SEC_EGRESS_DECOMPRESSION_RATIO_EXCEEDED',
  SEC_EGRESS_CONTENT_TYPE_REFUSED: 'SEC_EGRESS_CONTENT_TYPE_REFUSED',
  SEC_EGRESS_URL_MALFORMED: 'SEC_EGRESS_URL_MALFORMED',
  // --- untrusted-content isolation (FR-SEC-005, §35.4/§35.5, AC-051/AC-258)
  SEC_UNTRUSTED_INSTRUCTION_ROLE_REFUSED: 'SEC_UNTRUSTED_INSTRUCTION_ROLE_REFUSED',
  SEC_UNTRUSTED_LABEL_MISSING: 'SEC_UNTRUSTED_LABEL_MISSING',
  SEC_RENDER_SAFETY_POLICY_VIOLATED: 'SEC_RENDER_SAFETY_POLICY_VIOLATED',
  SEC_REMOTE_IMAGE_POLICY_REFUSED: 'SEC_REMOTE_IMAGE_POLICY_REFUSED',
  SEC_LINK_POLICY_REFUSED: 'SEC_LINK_POLICY_REFUSED',
  // --- webhook/callback integrity (FR-SEC-005, §35.6, AC-051)
  SEC_WEBHOOK_SIGNATURE_INVALID: 'SEC_WEBHOOK_SIGNATURE_INVALID',
  SEC_WEBHOOK_TIMESTAMP_STALE: 'SEC_WEBHOOK_TIMESTAMP_STALE',
  SEC_WEBHOOK_REPLAY_DETECTED: 'SEC_WEBHOOK_REPLAY_DETECTED',
  SEC_WEBHOOK_ENDPOINT_SOURCE_REFUSED: 'SEC_WEBHOOK_ENDPOINT_SOURCE_REFUSED',
  // --- abuse controls (FR-SEC-010, INV-003)
  SEC_ABUSE_RATE_LIMIT_EXCEEDED: 'SEC_ABUSE_RATE_LIMIT_EXCEEDED',
  SEC_ABUSE_AMPLIFICATION_REFUSED: 'SEC_ABUSE_AMPLIFICATION_REFUSED',
  SEC_ABUSE_QUOTA_EXHAUSTED_DEGRADED: 'SEC_ABUSE_QUOTA_EXHAUSTED_DEGRADED',
  SEC_ABUSE_ENUMERATION_SUSPECTED: 'SEC_ABUSE_ENUMERATION_SUSPECTED',
  SEC_ABUSE_PROTECTED_SUSPENSION_REFUSED: 'SEC_ABUSE_PROTECTED_SUSPENSION_REFUSED',
  SEC_PROTECTED_MONITORING_NEVER_SUSPENDED: 'SEC_PROTECTED_MONITORING_NEVER_SUSPENDED',
  // --- secret lifecycle & handling (FR-SEC-007, §35.11, AC-052)
  SEC_SECRET_CONTEXT_INSERTION_REFUSED: 'SEC_SECRET_CONTEXT_INSERTION_REFUSED',
  SEC_SECRET_LOG_EXPOSURE_REFUSED: 'SEC_SECRET_LOG_EXPOSURE_REFUSED',
  SEC_SECRET_EXPORT_REFUSED: 'SEC_SECRET_EXPORT_REFUSED',
  SEC_SECRET_UI_DISPLAY_REFUSED: 'SEC_SECRET_UI_DISPLAY_REFUSED',
  SEC_SECRET_MATERIAL_STORAGE_REFUSED: 'SEC_SECRET_MATERIAL_STORAGE_REFUSED',
  SEC_SECRET_LIFECYCLE_INVALID: 'SEC_SECRET_LIFECYCLE_INVALID',
  SEC_SECRET_ENV_FORBIDDEN_NAME: 'SEC_SECRET_ENV_FORBIDDEN_NAME',
  // --- supply chain (FR-SEC-006, §35.8, AC-254)
  SEC_DEPENDENCY_UNPINNED: 'SEC_DEPENDENCY_UNPINNED',
  SEC_LOCKFILE_MISSING: 'SEC_LOCKFILE_MISSING',
  SEC_LIFECYCLE_SCRIPT_RESTRICTED: 'SEC_LIFECYCLE_SCRIPT_RESTRICTED',
  SEC_SBOM_RECORD_INCOMPLETE: 'SEC_SBOM_RECORD_INCOMPLETE',
  SEC_BUILD_ATTESTATION_INCOMPLETE: 'SEC_BUILD_ATTESTATION_INCOMPLETE',
  // --- Alpha Lab import gating (FR-SEC-008, §35.14, ADR-044/046)
  SEC_IMPORT_FORMAT_REFUSED: 'SEC_IMPORT_FORMAT_REFUSED',
  SEC_IMPORT_LIMIT_EXCEEDED: 'SEC_IMPORT_LIMIT_EXCEEDED',
  SEC_IMPORT_PATH_UNSAFE: 'SEC_IMPORT_PATH_UNSAFE',
  SEC_IMPORT_SIGNATURE_INVALID: 'SEC_IMPORT_SIGNATURE_INVALID',
  SEC_IMPORT_PRODUCER_UNTRUSTED: 'SEC_IMPORT_PRODUCER_UNTRUSTED',
  SEC_IMPORT_HASH_MISMATCH: 'SEC_IMPORT_HASH_MISMATCH',
  SEC_IMPORT_STEP_UP_APPROVAL_REQUIRED: 'SEC_IMPORT_STEP_UP_APPROVAL_REQUIRED',
  SEC_IMPORT_STATE_TRANSITION_INVALID: 'SEC_IMPORT_STATE_TRANSITION_INVALID',
  SEC_IMPORT_ACTIVE_TRANSITION_REFUSED: 'SEC_IMPORT_ACTIVE_TRANSITION_REFUSED',
  // --- incidents (FR-SEC-011, §34/§35.9)
  SEC_INCIDENT_SEVERITY_UNKNOWN: 'SEC_INCIDENT_SEVERITY_UNKNOWN',
  SEC_INCIDENT_STATE_TRANSITION_INVALID: 'SEC_INCIDENT_STATE_TRANSITION_INVALID',
  SEC_INCIDENT_EVIDENCE_REQUIRED: 'SEC_INCIDENT_EVIDENCE_REQUIRED',
  // --- pauses / reactivation / activation ledger (AC-278, AC-279)
  SEC_PAUSE_AUTO_REACTIVATION_REFUSED: 'SEC_PAUSE_AUTO_REACTIVATION_REFUSED',
  SEC_PAUSE_RESUME_AUDIT_REQUIRED: 'SEC_PAUSE_RESUME_AUDIT_REQUIRED',
  SEC_ACTIVATION_EVENT_IMMUTABLE: 'SEC_ACTIVATION_EVENT_IMMUTABLE',
  // --- claims policy & public-output redaction (FR-SEC-010/012, AC-276/277)
  SEC_CLAIMS_POLICY_VIOLATED: 'SEC_CLAIMS_POLICY_VIOLATED',
  SEC_PUBLIC_OUTPUT_FIELD_MISSING: 'SEC_PUBLIC_OUTPUT_FIELD_MISSING',
  SEC_PUBLIC_OUTPUT_REDACTION_REQUIRED: 'SEC_PUBLIC_OUTPUT_REDACTION_REQUIRED',
  // --- prohibited-capability proof surface (FR-SEC-003, §35.7/§41.1, AC-256)
  SEC_PROHIBITED_CAPABILITY_DETECTED: 'SEC_PROHIBITED_CAPABILITY_DETECTED',
  SEC_DECODER_AUTHORITY_INVALID: 'SEC_DECODER_AUTHORITY_INVALID',
  // --- credential lifecycle (FR-SEC-001, §35.12, AC-053)
  SEC_CREDENTIAL_UNKNOWN: 'SEC_CREDENTIAL_UNKNOWN',
  SEC_CREDENTIAL_ENTROPY_INSUFFICIENT: 'SEC_CREDENTIAL_ENTROPY_INSUFFICIENT',
  SEC_CREDENTIAL_REVOKED: 'SEC_CREDENTIAL_REVOKED',
  SEC_CREDENTIAL_EXPIRED: 'SEC_CREDENTIAL_EXPIRED',
  SEC_CREDENTIAL_SCOPE_EXCEEDED: 'SEC_CREDENTIAL_SCOPE_EXCEEDED',
  SEC_CREDENTIAL_ORIGIN_MISMATCH: 'SEC_CREDENTIAL_ORIGIN_MISMATCH',
} as const;

export type SecErrorCode = (typeof SecErrorCode)[keyof typeof SecErrorCode];

/** Context carried alongside a machine code (never secrets, never payloads). */
export type SecErrorDetail = Readonly<Record<string, string | number | boolean | null>>;

function secSubclass(
  name: string,
  defaultCode: SecErrorCode,
): new (message: string, detail?: SecErrorDetail, code?: SecErrorCode) => ForesiftSecurityError {
  return class extends ForesiftSecurityError {
    constructor(message: string, detail: SecErrorDetail = {}, code: SecErrorCode = defaultCode) {
      super(code, message, detail);
      this.name = name;
    }
  };
}

/**
 * Base class for every security-perimeter refusal. Extends the domain
 * `ForesiftError` so repository-wide handling keeps working while callers can
 * additionally narrow on `SecErrorCode` values.
 */
export class ForesiftSecurityError extends Error {
  readonly code: SecErrorCode | string;
  readonly detail: SecErrorDetail;

  constructor(code: SecErrorCode | string, message: string, detail: SecErrorDetail = {}) {
    super(`${code}: ${message}`);
    this.name = 'ForesiftSecurityError';
    this.code = code;
    this.detail = detail;
  }
}

/** Audit-chain append/verify/checkpoint refusals. */
export class AuditChainError extends secSubclass(
  'AuditChainError',
  SecErrorCode.SEC_AUDIT_CHAIN_VERIFICATION_FAILED,
) {}
/** High-impact action-gate refusals (step-up, CSRF, idempotency, reason). */
export class ActionGateError extends secSubclass(
  'ActionGateError',
  SecErrorCode.SEC_STEP_UP_PROOF_MISSING,
) {}
/** MCP Origin decision refusals. */
export class McpOriginError extends secSubclass(
  'McpOriginError',
  SecErrorCode.SEC_ORIGIN_NOT_ALLOWLISTED,
) {}
/** MCP protocol/session guard refusals. */
export class ProtocolGuardError extends secSubclass(
  'ProtocolGuardError',
  SecErrorCode.SEC_PROTOCOL_REVISION_UNSUPPORTED,
) {}
/** OAuth token-binding refusals. */
export class OAuthBindingError extends secSubclass(
  'OAuthBindingError',
  SecErrorCode.SEC_OAUTH_PKCE_REQUIRED,
) {}
/** Egress/SSRF guard refusals (deny-by-default). */
export class EgressError extends secSubclass(
  'EgressError',
  SecErrorCode.SEC_EGRESS_HOST_NOT_ALLOWLISTED,
) {}
/** Untrusted-content isolation and render-safety refusals. */
export class UntrustedContentError extends secSubclass(
  'UntrustedContentError',
  SecErrorCode.SEC_UNTRUSTED_INSTRUCTION_ROLE_REFUSED,
) {}
/** Webhook/callback integrity refusals. */
export class WebhookIntegrityError extends secSubclass(
  'WebhookIntegrityError',
  SecErrorCode.SEC_WEBHOOK_SIGNATURE_INVALID,
) {}
/** Abuse-control refusals (flood, amplification, enumeration). */
export class AbuseControlError extends secSubclass(
  'AbuseControlError',
  SecErrorCode.SEC_ABUSE_RATE_LIMIT_EXCEEDED,
) {}
/** Secret lifecycle/handling refusals. */
export class SecretsPolicyError extends secSubclass(
  'SecretsPolicyError',
  SecErrorCode.SEC_SECRET_CONTEXT_INSERTION_REFUSED,
) {}
/** Supply-chain policy refusals. */
export class SupplyChainError extends secSubclass(
  'SupplyChainError',
  SecErrorCode.SEC_DEPENDENCY_UNPINNED,
) {}
/** Import-quarantine gate refusals. */
export class ImportGatingError extends secSubclass(
  'ImportGatingError',
  SecErrorCode.SEC_IMPORT_FORMAT_REFUSED,
) {}
/** Incident-record refusals. */
export class IncidentError extends secSubclass(
  'IncidentError',
  SecErrorCode.SEC_INCIDENT_STATE_TRANSITION_INVALID,
) {}
/** Pause/reactivation ledger refusals. */
export class GatePauseError extends secSubclass(
  'GatePauseError',
  SecErrorCode.SEC_PAUSE_AUTO_REACTIVATION_REFUSED,
) {}
/** Claims-policy and public-output redaction refusals. */
export class ClaimsPolicyError extends secSubclass(
  'ClaimsPolicyError',
  SecErrorCode.SEC_CLAIMS_POLICY_VIOLATED,
) {}
/** Prohibited-capability scan/canary refusals. */
export class ProhibitedCapabilityError extends secSubclass(
  'ProhibitedCapabilityError',
  SecErrorCode.SEC_PROHIBITED_CAPABILITY_DETECTED,
) {}
/** MCP credential lifecycle refusals. */
export class CredentialError extends secSubclass(
  'CredentialError',
  SecErrorCode.SEC_CREDENTIAL_REVOKED,
) {}

/** Narrowing guard for security-perimeter errors. */
export function isForesiftSecurityError(value: unknown): value is ForesiftSecurityError {
  return value instanceof ForesiftSecurityError;
}
