/**
 * Exact per-adapter allowlist contract (FR-PROV-005; §35.3 cooperation,
 * AC-257). The eleven enforced dimensions split across two deny-by-default
 * layers composed here:
 *
 *   * `EgressGuard` (@foresift/security) — scheme, host, port, redirect
 *     policy, byte/time caps, and the DNS/IP policy (resolve→pin with
 *     denied-range validation);
 *   * this contract layer — HTTP method, path template, request fields
 *     (query parameters), response content type(s), maximum response bytes,
 *     and the response schema every body must satisfy before an adapter may
 *     return it.
 *
 * Anything not explicitly declared for an operation refuses with a typed
 * provider error naming the violated dimension. Adapters cannot route
 * around the layer: outbound execution goes through `execute()`, which
 * sequences authorize → fetch via the INJECTED FetchPort → inspect, and the
 * contract never follows redirects (following one would need an explicit
 * multi-hop loop that re-runs authorization per hop).
 */
import type { ZodType } from 'zod';
import { EgressGuard, type EgressResolver } from '@foresift/security';
import type { EgressAllowlistEntry } from '@foresift/shared-schemas';
import { AllowlistError, ProvErrorCode } from '@foresift/provider-lifecycle';
import type { FetchPort, ProviderHttpRequest, ProviderHttpResponse } from './fetch-port.ts';

/** Redirect policy: deny-by-default. The default refuses every 3xx;
 * the approved-hosts variant exists for transports that implement an
 * explicit re-authorizing hop loop — this contract itself never follows. */
export type AdapterRedirectPolicy =
  | { readonly policy: 'NONE' }
  | {
      readonly policy: 'APPROVED_HOSTS_ONLY';
      readonly maxHops: number;
      readonly approvedHosts: readonly string[];
    };

/**
 * One operation's exact allowlist descriptor. Absence of any dimension is a
 * registration-time refusal; presence at runtime is enforced per request.
 */
export interface AdapterAllowlistDescriptor {
  readonly operationId: string;
  /** Egress-layer declaration (scheme/host/port/plane). */
  readonly egress: EgressAllowlistEntry;
  /** Read-only boundary: GET is the only constructible method. */
  readonly method: 'GET';
  /** Literal segments plus `{param}` placeholders, e.g. `/api/v1/tokens/{address}`. */
  readonly pathTemplate: string;
  /** Request-field dimension: exact query-parameter names admitted. */
  readonly queryParamAllowlist: readonly string[];
  /** Content-type dimension for responses (GET requests carry no body). */
  readonly responseContentTypes: readonly string[];
  /** Response-schema dimension: parsed bodies must satisfy this schema. */
  readonly responseSchema: ZodType;
  readonly maxResponseBytes: number;
  readonly redirects: AdapterRedirectPolicy;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class AdapterContract {
  private readonly byOperation: ReadonlyMap<string, AdapterAllowlistDescriptor>;
  private readonly guard: EgressGuard;

  constructor(options: {
    readonly descriptors: readonly AdapterAllowlistDescriptor[];
    readonly resolver: EgressResolver;
  }) {
    this.byOperation = new Map(options.descriptors.map((d) => [d.operationId, d]));
    // The guard's allowlist IS the adapter set's egress declarations — there
    // is no second place where hosts could drift apart.
    this.guard = new EgressGuard({
      allowlist: [...options.descriptors].map((d) => d.egress),
      resolver: options.resolver,
    });
  }

  descriptorFor(operationId: string): AdapterAllowlistDescriptor | undefined {
    return this.byOperation.get(operationId);
  }

  get descriptors(): readonly AdapterAllowlistDescriptor[] {
    return [...this.byOperation.values()];
  }

  /**
   * Full pre-flight for one outbound request: contract-layer dimensions
   * first (precise typed reasons), then the security EgressGuard's full
   * authorize flow (URL hygiene, DNS resolution, denied IP ranges). Returns
   * the matched descriptor on success.
   */
  async authorizeRequest(
    operationId: string,
    url: string,
    request?: { readonly method?: 'GET' } | undefined,
  ): Promise<AdapterAllowlistDescriptor> {
    const descriptor = this.byOperation.get(operationId);
    if (descriptor === undefined) {
      throw new AllowlistError(
        `no allowlist descriptor registered for operation ${operationId}`,
        { operationId },
        ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      );
    }
    const requestedMethod = request?.method ?? 'GET';
    if (requestedMethod !== descriptor.method || requestedMethod !== 'GET') {
      throw new AllowlistError(
        `method ${requestedMethod} is not declared for ${operationId} (provider intelligence is GET-only)`,
        { operationId, method: requestedMethod },
        ProvErrorCode.PROV_ALLOWLIST_METHOD_REFUSED,
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AllowlistError(`unparseable request URL for ${operationId}`, { operationId }, ProvErrorCode.PROV_ALLOWLIST_PATH_REFUSED);
    }
    if (parsed.protocol !== `${descriptor.egress.scheme}:`) {
      throw new AllowlistError(
        `scheme '${parsed.protocol.replace(':', '')}' is not declared for ${operationId}`,
        { operationId, dimension: 'scheme', actual: parsed.protocol.replace(':', '') },
        ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      );
    }
    if (parsed.hostname.toLowerCase() !== descriptor.egress.host.toLowerCase()) {
      throw new AllowlistError(
        `host '${parsed.hostname}' is not declared for ${operationId}`,
        { operationId, dimension: 'host', actual: parsed.hostname },
        ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      );
    }
    const port = parsed.port === '' ? 443 : Number(parsed.port);
    if (port !== descriptor.egress.port) {
      throw new AllowlistError(
        `port ${String(port)} is not declared for ${operationId}`,
        { operationId, dimension: 'port', port },
        ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      );
    }
    if (!pathMatchesTemplate(descriptor.pathTemplate, parsed.pathname)) {
      throw new AllowlistError(
        `path '${parsed.pathname}' does not match declared template '${descriptor.pathTemplate}'`,
        { operationId, actualPath: parsed.pathname, template: descriptor.pathTemplate },
        ProvErrorCode.PROV_ALLOWLIST_PATH_REFUSED,
      );
    }
    for (const name of parsed.searchParams.keys()) {
      if (!descriptor.queryParamAllowlist.includes(name)) {
        throw new AllowlistError(
          `request field '${name}' is not declared for ${operationId}`,
          { operationId, field: name },
          ProvErrorCode.PROV_ALLOWLIST_REQUEST_FIELD_REFUSED,
        );
      }
    }

    const decision = await this.guard.authorize(url, descriptor.egress.plane);
    if (decision.decision !== 'ALLOW') {
      throw new AllowlistError(`egress refused (${decision.reason}): ${decision.detail}`, {
        operationId,
        dimension: 'dns-ip-policy',
        reason: decision.reason,
      }, ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED);
    }
    return descriptor;
  }

  /** The only request shape the contract will ever emit: frozen GET. */
  buildRequest(url: string): ProviderHttpRequest {
    return Object.freeze({ url, method: 'GET' as const });
  }

  /**
   * Response-side enforcement: status, redirects (always refused here),
   * content type, byte cap, JSON parse, and the declared response schema.
   * Returns the validated body — adapters never see unvalidated text.
   */
  inspectResponse(descriptor: AdapterAllowlistDescriptor, response: ProviderHttpResponse): unknown {
    if (REDIRECT_STATUSES.has(response.status)) {
      throw new AllowlistError(
        `redirect status ${String(response.status)} refused by redirect policy '${
          descriptor.redirects.policy
        }' — following requires an explicit re-authorizing hop loop`,
        { operationId: descriptor.operationId, dimension: 'redirects', status: response.status },
        ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new AllowlistError(
        `response status ${String(response.status)} is not a success for ${descriptor.operationId}`,
        { operationId: descriptor.operationId, dimension: 'status', status: response.status },
        ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      );
    }
    const contentType = (response.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!descriptor.responseContentTypes.includes(contentType)) {
      throw new AllowlistError(
        `content type '${contentType}' is not declared for ${descriptor.operationId}`,
        { operationId: descriptor.operationId, contentType },
        ProvErrorCode.PROV_ALLOWLIST_CONTENT_TYPE_REFUSED,
      );
    }
    const bytes = Buffer.byteLength(response.bodyText, 'utf8');
    if (bytes > descriptor.maxResponseBytes) {
      throw new AllowlistError(
        `response of ${String(bytes)} bytes exceeds the declared max ${String(descriptor.maxResponseBytes)}`,
        { operationId: descriptor.operationId, bytes, maxResponseBytes: descriptor.maxResponseBytes },
        ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(response.bodyText) as unknown;
    } catch {
      throw new AllowlistError(
        `response body is not valid JSON for ${descriptor.operationId}`,
        { operationId: descriptor.operationId },
        ProvErrorCode.PROV_ALLOWLIST_RESPONSE_SCHEMA_REFUSED,
      );
    }
    const checked = descriptor.responseSchema.safeParse(body);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      throw new AllowlistError(
        `response schema mismatch for ${descriptor.operationId} at ${issue?.path.join('.') ?? '(root)'}`,
        { operationId: descriptor.operationId, path: issue?.path.join('.') ?? '' },
        ProvErrorCode.PROV_ALLOWLIST_RESPONSE_SCHEMA_REFUSED,
      );
    }
    return checked.data;
  }

  /** Authorize → injected transport → inspect. THE only execution path. */
  async execute(
    fetch: FetchPort,
    operationId: string,
    url: string,
    request?: { readonly method?: 'GET' } | undefined,
  ): Promise<unknown> {
    const descriptor = await this.authorizeRequest(operationId, url, request);
    const response = await fetch.fetch(this.buildRequest(url));
    return this.inspectResponse(descriptor, response);
  }
}

/** Segment-wise template match: `{param}` matches exactly one non-empty segment. */
function pathMatchesTemplate(template: string, actualPath: string): boolean {
  const tpl = template.split('/').filter((s) => s !== '');
  const act = actualPath.split('/').filter((s) => s !== '');
  if (tpl.length !== act.length) return false;
  return tpl.every((seg, i) => {
    const actual = act[i] ?? '';
    if (actual === '') return false;
    return seg.startsWith('{') && seg.endsWith('}') ? true : seg === actual;
  });
}

/** URL builder adapters use so query encoding is uniform and auditable. */
export function buildQueryUrl(base: string, path: string, query?: Readonly<Record<string, string>>): string {
  const url = new URL(`${base.replace(/\/$/, '')}${path}`);
  if (query !== undefined) {
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  }
  return url.toString();
}
