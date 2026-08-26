/**
 * Injectable HTTP transport seam (FR-PROV-005; T114).
 *
 * Adapter code NEVER touches global fetch in decision paths: every outbound
 * call goes through a {@link FetchPort} supplied by the composition root.
 * Tests inject recorded transports; production injects one wired behind the
 * security EgressGuard's authorize→pin→connect flow. The seam carries byte
 * counts and content types explicitly so the adapter validation layer can
 * enforce response caps without sniffing streams.
 */

export interface AdapterHttpRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  /** Pre-encoded body; GET requests carry none. */
  readonly body?: string | undefined;
}

export interface AdapterHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyBytes: number;
  readonly bodyText: string;
}

export type FetchPort = (request: AdapterHttpRequest) => Promise<AdapterHttpResponse>;

/**
 * Composition-root adapter from global fetch to the port. This is the ONLY
 * place global fetch may appear, and the returned port must only ever be
 * handed to adapters whose every request has already passed egress
 * authorization + pin verification (the adapter client enforces that order).
 */
export function fetchPortFromGlobal(): FetchPort {
  return async (request) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers },
      ...(request.body !== undefined ? { body: request.body } : {}),
      redirect: 'manual',
    });
    const bodyText = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      headers,
      bodyBytes: Buffer.byteLength(bodyText, 'utf8'),
      bodyText,
    };
  };
}

/** Deterministic recorded transport for contract tests and fixtures. */
export function recordedFetchPort(
  routes: ReadonlyMap<string, AdapterHttpResponse>,
): FetchPort {
  return async (request) => {
    const hit = routes.get(`${request.method} ${request.url}`);
    if (hit === undefined) {
      throw new Error(`recorded fetch port has no route for ${request.method} ${request.url}`);
    }
    return hit;
  };
}
