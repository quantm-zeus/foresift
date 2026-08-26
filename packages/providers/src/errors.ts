/**
 * Typed refusals for the adapter framework (FR-PROV-004…007; T114/T115).
 *
 * Deny-by-default means EVERY undeclared dimension has its own refusal code:
 * an undeclared method, path, query field, body field, content type, or
 * response shape refuses with a code naming the dimension — never a generic
 * error a caller could misread as transient.
 */
export const ProvAdapterErrorCode = {
  /** Catalog entry without an exact allowlist descriptor (T115). */
  PROV_ADAPTER_ALLOWLIST_REQUIRED: 'PROV_ADAPTER_ALLOWLIST_REQUIRED',
  /** Wholesale multi-operation bundle exposure under one descriptor (T115). */
  PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED: 'PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED',
  /** Capability class outside the allowed vocabulary (T115). */
  PROV_ADAPTER_CAPABILITY_UNKNOWN: 'PROV_ADAPTER_CAPABILITY_UNKNOWN',
  /** Prohibited (trading/signing/custody) capability class (T115). */
  PROV_ADAPTER_CAPABILITY_PROHIBITED: 'PROV_ADAPTER_CAPABILITY_PROHIBITED',
  /** HTTP method not declared on the descriptor. */
  PROV_ADAPTER_METHOD_REFUSED: 'PROV_ADAPTER_METHOD_REFUSED',
  /** Concrete path does not match the declared template. */
  PROV_ADAPTER_PATH_REFUSED: 'PROV_ADAPTER_PATH_REFUSED',
  /** Query parameter outside the descriptor's allowlist. */
  PROV_ADAPTER_QUERY_FIELD_REFUSED: 'PROV_ADAPTER_QUERY_FIELD_REFUSED',
  /** JSON body field outside the descriptor's allowlist. */
  PROV_ADAPTER_REQUEST_FIELD_REFUSED: 'PROV_ADAPTER_REQUEST_FIELD_REFUSED',
  /** Content type not admitted for the direction. */
  PROV_ADAPTER_CONTENT_TYPE_REFUSED: 'PROV_ADAPTER_CONTENT_TYPE_REFUSED',
  /** Redirect policy violation (undeclared or cross-origin hop). */
  PROV_ADAPTER_REDIRECT_REFUSED: 'PROV_ADAPTER_REDIRECT_REFUSED',
  /** The security EgressGuard refused the destination or pin verification. */
  PROV_ADAPTER_EGRESS_REFUSED: 'PROV_ADAPTER_EGRESS_REFUSED',
  /** Response bytes above the descriptor cap. */
  PROV_ADAPTER_RESPONSE_BYTES_EXCEEDED: 'PROV_ADAPTER_RESPONSE_BYTES_EXCEEDED',
  /** Recorded response failed its operation response schema. */
  PROV_ADAPTER_RESPONSE_INVALID: 'PROV_ADAPTER_RESPONSE_INVALID',
  /** Plan-gated operation unavailable on the active plan (STRICT_FREE). */
  PROV_ADAPTER_PLAN_GATED_UNAVAILABLE: 'PROV_ADAPTER_PLAN_GATED_UNAVAILABLE',
  /** Deprecated enhanced parser used without a valid migration exception. */
  PROV_ADAPTER_DEPRECATED_PARSER_BLOCKED: 'PROV_ADAPTER_DEPRECATED_PARSER_BLOCKED',
} as const;

export type ProvAdapterErrorCodeValue =
  (typeof ProvAdapterErrorCode)[keyof typeof ProvAdapterErrorCode];

export class ProviderAdapterError extends Error {
  readonly code: ProvAdapterErrorCodeValue;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    details: Record<string, unknown>,
    code: ProvAdapterErrorCodeValue,
  ) {
    super(message);
    this.name = 'ProviderAdapterError';
    this.code = code;
    this.details = details;
  }
}
