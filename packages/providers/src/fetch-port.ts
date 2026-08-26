/**
 * Injectable transport port for provider adapters (FR-PROV-004/005; plan
 * material decision 3).
 *
 * Adapters NEVER touch the network directly: every outbound read goes through
 * a FetchPort, which composes the security EgressGuard (exact allowlist +
 * DNS pinning) BEFORE handing bytes to the injected low-level transport. The
 * seam keeps collectors deterministic in tests (stub transports, no sockets)
 * and deny-by-default in production.
 *
 * The port is GET-only BY CONSTRUCTION: `FetchPortRequest` has no method
 * field and no body — a write verb is not merely refused here, it is not
 * representable in a well-formed request. Refusals are typed onto the
 * provider-lifecycle ProvErrorCode vocabulary so callers handle one error
 * family end-to-end.
 */
import type { EgressDecision } from '@foresift/shared-schemas';
import {
  ProviderLifecycleError,
  ProvErrorCode,
  type ProvErrorDetail,
} from '@foresift/provider-lifecycle';

/** A completed provider response as raw bytes + content type (unparsed). */
export interface ProviderHttpResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly bodyBytes: Uint8Array | null;
  /** Present only when the status is a redirect the port must re-decide. */
  readonly locationHeader: string | null;
}

/** The lowest-level seam: move bytes for ONE already-authorized URL. Only
 * the FetchPort may call this; adapter code can never route around it. */
export type TransportFn = (input: {
  readonly url: string;
  readonly pinnedAddresses: readonly string[];
  readonly signal?: AbortSignal;
}) => Promise<ProviderHttpResponse>;

export interface FetchPortRequest {
  /** Absolute https URL WITHOUT query string (query travels separately). */
  readonly url: string;
  /** Egress plane; provider collection always uses COLLECTOR. */
  readonly plane: 'COLLECTOR' | 'CONTROL_PLANE' | 'ALPHA_LAB';
  /** Query parameters to send; every key MUST be pre-declared. */
  readonly query?: Readonly<Record<string, string>> | undefined;
  /** The exact query-parameter names this operation declared at registration.
   * Absent/empty ⇒ NO parameter may be sent. */
  readonly declaredQueryParams?: readonly string[] | undefined;
  /** Media types the operation's raw-output schema admits (e.g.
   * 'application/json'); parameters (';charset=…') are ignored when matching. */
  readonly expectedContentTypes: readonly string[];
  /** Hard byte ceiling for THIS operation's responses. */
  readonly maxResponseBytes: number;
}

/** Structural minimalism of the guard surface keeps the import graph one-way:
 * providers see only the two calls it composes, typed structurally. */
export interface EgressGuardSurface {
  authorize(url: string, plane: string): Promise<EgressDecision>;
  verifyPin(url: string, pinnedAddresses: readonly string[]): Promise<EgressDecision>;
  authorizeRedirect(
    nextUrl: string,
    plane: string,
    hopsFollowed: number,
    approveHop: (nextUrl: string) => boolean,
  ): Promise<EgressDecision>;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 3;

function mediaTypeOf(contentType: string | null): string | null {
  if (contentType === null) return null;
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? null;
}

export class EgressFetchPort {
  private readonly guard: EgressGuardSurface;
  private readonly transport: TransportFn;
  private readonly maxRedirects: number;

  constructor(deps: {
    readonly guard: EgressGuardSurface;
    readonly transport: TransportFn;
    readonly maxRedirects?: number | undefined;
  }) {
    this.guard = deps.guard;
    this.transport = deps.transport;
    this.maxRedirects = deps.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  }

  async execute(request: FetchPortRequest): Promise<ProviderHttpResponse> {
    const startUrl = this.buildUrl(request);
    const approvedRedirectTargets = new Set<string>([startUrl]);
    let currentUrl = startUrl;
    let hopsFollowed = 0;

    for (;;) {
      const pinnedAddresses = await this.authorizeOrThrow(currentUrl, request.plane);
      const response = await this.transport({ url: currentUrl, pinnedAddresses });

      if (
        REDIRECT_STATUSES.has(response.status) &&
        response.locationHeader !== null &&
        response.locationHeader !== ''
      ) {
        let nextUrl: string;
        try {
          nextUrl = new URL(response.locationHeader, currentUrl).toString();
        } catch {
          throw this.refusal(
            ProvErrorCode.PROV_REDIRECT_POLICY_REFUSED,
            'redirect Location header is unparseable',
            { location: response.locationHeader },
          );
        }
        // Deny-by-default: a redirect may only land on targets the operator
        // approved (default policy: never leave the origin host).
        const decision = await this.guard.authorizeRedirect(
          nextUrl,
          request.plane,
          hopsFollowed,
          (target) =>
            target === startUrl ||
            approvedRedirectTargets.has(target) ||
            this.sameHost(startUrl, target),
        );
        if (decision.decision === 'REFUSE') {
          throw this.refusal(
            ProvErrorCode.PROV_REDIRECT_POLICY_REFUSED,
            `redirect policy refused (${decision.reason}): ${decision.detail}`,
            { guardReason: decision.reason, target: nextUrl },
          );
        }
        hopsFollowed += 1;
        if (hopsFollowed > this.maxRedirects) {
          throw this.refusal(
            ProvErrorCode.PROV_REDIRECT_POLICY_REFUSED,
            `more than ${String(this.maxRedirects)} redirects`,
            {},
          );
        }
        approvedRedirectTargets.add(nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      this.assertContentType(response, request.expectedContentTypes);
      this.assertByteLimit(response, request.maxResponseBytes);
      return response;
    }
  }

  /** Query keys ⊆ declared names, else PROV_REQUEST_FIELD_NOT_DECLARED.
   * With no declaration at all, ANY parameter is undeclared. */
  private buildUrl(request: FetchPortRequest): string {
    const declared = request.declaredQueryParams ?? [];
    const provided = Object.keys(request.query ?? {});
    for (const key of provided) {
      if (!declared.includes(key)) {
        throw this.refusal(ProvErrorCode.PROV_REQUEST_FIELD_NOT_DECLARED, `query parameter "${key}" was never declared for this operation`, { field: key });
      }
    }
    if (provided.length === 0) return request.url;
    try {
      const parsed = new URL(request.url);
      parsed.search = new URLSearchParams(request.query ?? {}).toString();
      return parsed.toString();
    } catch {
      throw this.refusal(
        ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
        'request base URL is unparseable',
        { url: request.url },
      );
    }
  }

  /** authorize → verifyPin per hop; refusals map onto the Prov vocabulary. */
  private async authorizeOrThrow(url: string, plane: string): Promise<readonly string[]> {
    const authorization = await this.guard.authorize(url, plane);
    if (authorization.decision === 'REFUSE') {
      this.throwEgressRefusal(authorization.reason, authorization.detail);
    }
    const pin = await this.guard.verifyPin(url, authorization.pinnedAddresses);
    if (pin.decision === 'REFUSE') {
      this.throwEgressRefusal(pin.reason, pin.detail);
    }
    return authorization.pinnedAddresses;
  }

  private throwEgressRefusal(reason: string, detail: string): never {
    switch (reason) {
      case 'HOST_NOT_ALLOWLISTED':
      case 'SCHEME_REFUSED':
      case 'PORT_UNSAFE':
      case 'URL_MALFORMED':
        // Scheme/port/host are dimensions of the declared allowlist entry;
        // refusing here means that dimension was never declared as allowed.
        throw this.refusal(ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED, `${reason}: ${detail}`, {
          guardReason: reason,
        });
      case 'ADDRESS_DENIED':
      case 'RESOLUTION_REFUSED':
      case 'REBINDING_DETECTED':
        throw this.refusal(ProvErrorCode.PROV_DNS_POLICY_REFUSED, `${reason}: ${detail}`, {
          guardReason: reason,
        });
      case 'RESPONSE_BYTES_EXCEEDED':
        throw this.refusal(ProvErrorCode.PROV_RESPONSE_BYTES_EXCEEDED, detail, {
          guardReason: reason,
        });
      case 'CONTENT_TYPE_REFUSED':
        throw this.refusal(ProvErrorCode.PROV_RESPONSE_CONTENT_TYPE_REFUSED, detail, {
          guardReason: reason,
        });
      default:
        throw this.refusal(ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED, `${reason}: ${detail}`, {
          guardReason: reason,
        });
    }
  }

  private assertContentType(response: ProviderHttpResponse, expected: readonly string[]): void {
    const actual = mediaTypeOf(response.contentType);
    const allowed = new Set(expected.map((value) => value.split(';', 1)[0]?.trim().toLowerCase() ?? value));
    if (actual === null || !allowed.has(actual)) {
      throw this.refusal(
        ProvErrorCode.PROV_RESPONSE_CONTENT_TYPE_REFUSED,
        `response content type ${response.contentType ?? '<absent>'} outside declared set`,
        { actual: response.contentType, expected: expected.join(',') },
      );
    }
  }

  private assertByteLimit(response: ProviderHttpResponse, maxResponseBytes: number): void {
    const size = response.bodyBytes?.byteLength ?? 0;
    if (size > maxResponseBytes) {
      throw this.refusal(ProvErrorCode.PROV_RESPONSE_BYTES_EXCEEDED, `response of ${String(size)} bytes exceeds the declared ceiling`, {
        byteSize: size,
        maxResponseBytes,
      });
    }
  }

  private sameHost(a: string, b: string): boolean {
    try {
      return new URL(a).host === new URL(b).host;
    } catch {
      return false;
    }
  }

  private refusal(
    code: string,
    message: string,
    detail: ProvErrorDetail = {},
  ): ProviderLifecycleError {
    return new ProviderLifecycleError(code, message, detail);
  }
}
