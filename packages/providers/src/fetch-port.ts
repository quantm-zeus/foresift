/**
 * Injectable transport seam (FR-PROV-004; plan material decision 3).
 *
 * Adapter decision paths NEVER touch global `fetch`: every outbound provider
 * call goes through a FetchPort supplied at composition time. This keeps
 * adapters unit-testable without network I/O and lets the security perimeter
 * (EgressGuard) wrap or refuse transports uniformly.
 */

/** A single outbound request an adapter may issue. GET-only by construction:
 * provider intelligence is a read-only surface (permanent product boundary). */
export interface ProviderHttpRequest {
  readonly url: string;
  readonly method?: 'GET';
  /** Case-insensitive header names as the adapter wants them sent. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Per-request budget; the port must abort beyond it. */
  readonly timeoutMs?: number;
}

/** The minimal response shape adapters decode from. The body is text: JSON
 * decoding happens inside the adapter against its declared response schema,
 * never raw pass-through. */
export interface ProviderHttpResponse {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly bodyText: string;
}

export interface FetchPort {
  fetch(request: ProviderHttpRequest): Promise<ProviderHttpResponse>;
}
