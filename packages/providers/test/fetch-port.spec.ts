// FetchPort (FR-PROV-004/005; T114): GET-by-construction transport seam that
// composes EgressGuard authorize → pin verification before any byte moves,
// with every refusal typed onto the ProvErrorCode vocabulary.
import { describe, expect, it, vi } from 'vitest';
import type { EgressDecision } from '@foresift/shared-schemas';
import {
  EgressFetchPort,
  type EgressGuardSurface,
  type ProviderHttpResponse,
  type TransportFn,
} from '../src/index.ts';

const PINNED = ['203.0.113.10'];

function allow(host = 'gmgn.ai'): EgressDecision {
  return { decision: 'ALLOW', host, pinnedAddresses: PINNED };
}

function refuse(reason: string, detail = 'stub'): EgressDecision {
  return { decision: 'REFUSE', reason: reason as never, detail };
}

interface GuardScript {
  readonly authorize?: EgressDecision;
  readonly verifyPin?: EgressDecision;
  readonly redirectLimit?: number;
}

function fakeGuard(script: GuardScript = {}): EgressGuardSurface & {
  authorizeCalls: string[];
} {
  const authorizeCalls: string[] = [];
  return {
    authorizeCalls,
    authorize: vi.fn(async (url: string) => {
      authorizeCalls.push(url);
      return script.authorize ?? allow();
    }),
    verifyPin: vi.fn(async () => script.verifyPin ?? allow()),
    authorizeRedirect: vi.fn(async (
      nextUrl: string,
      _plane: string,
      hopsFollowed: number,
      approveHop: (nextUrl: string) => boolean,
    ) => {
      if (hopsFollowed + 1 > (script.redirectLimit ?? 3)) {
        return refuse('REDIRECT_LIMIT_EXCEEDED');
      }
      if (!approveHop(nextUrl)) {
        return refuse('REDIRECT_UNAPPROVED');
      }
      // The real guard ends with an internal authorize(); the port then
      // authorizes the hop itself, so only authorize() records calls here.
      return script.authorize ?? allow();
    }),
  };
}

function jsonResponse(overrides: Partial<ProviderHttpResponse> = {}): ProviderHttpResponse {
  return {
    status: 200,
    contentType: 'application/json',
    bodyBytes: new TextEncoder().encode('{"ok":true}'),
    locationHeader: null,
    ...overrides,
  };
}

const BASE_REQUEST = {
  url: 'https://gmgn.ai/defi/quotation/v1/tokens/price',
  plane: 'COLLECTOR' as const,
  expectedContentTypes: ['application/json'],
  maxResponseBytes: 65_536,
};

describe('EgressFetchPort', () => {
  it('moves bytes only after authorize + pin verification, passing pinned addresses to the transport', async () => {
    const guard = fakeGuard();
    const transportCalls: Array<{ url: string; pinnedAddresses: readonly string[] }> = [];
    const transport: TransportFn = async (input) => {
      transportCalls.push({ url: input.url, pinnedAddresses: input.pinnedAddresses });
      return jsonResponse();
    };
    const port = new EgressFetchPort({ guard, transport });
    const response = await port.execute(BASE_REQUEST);
    expect(response.status).toBe(200);
    expect(transportCalls).toEqual([{ url: BASE_REQUEST.url, pinnedAddresses: PINNED }]);
    expect(guard.authorize).toHaveBeenCalledWith(BASE_REQUEST.url, 'COLLECTOR');
  });

  it('appends declared query parameters to the request URL', async () => {
    let seenUrl = '';
    const port = new EgressFetchPort({
      guard: fakeGuard(),
      transport: async (input) => {
        seenUrl = input.url;
        return jsonResponse();
      },
    });
    await port.execute({
      ...BASE_REQUEST,
      query: { chain: 'solana', address: 'So11111111111111111111111111111111' },
      declaredQueryParams: ['chain', 'address'],
    });
    expect(seenUrl).toContain('chain=solana');
    expect(seenUrl).toContain('address=So11111111111111111111111111111111');
  });

  it('refuses undeclared query parameters BEFORE any egress attempt', async () => {
    const guard = fakeGuard();
    const transport = vi.fn(async () => jsonResponse());
    const port = new EgressFetchPort({ guard, transport });
    await expect(
      port.execute({ ...BASE_REQUEST, query: { sneaky: '1' }, declaredQueryParams: ['chain'] }),
    ).rejects.toMatchObject({ code: 'PROV_REQUEST_FIELD_NOT_DECLARED', detail: { field: 'sneaky' } });
    // Deny-by-default: no declaration at all ⇒ ANY parameter is undeclared.
    await expect(
      port.execute({ ...BASE_REQUEST, query: { chain: 'solana' } }),
    ).rejects.toMatchObject({ code: 'PROV_REQUEST_FIELD_NOT_DECLARED' });
    expect(transport).not.toHaveBeenCalled();
    expect(guard.authorize).not.toHaveBeenCalled();
  });

  it('maps allowlist and DNS-policy guard refusals onto the Prov vocabulary', async () => {
    const notAllowlisted = new EgressFetchPort({
      guard: fakeGuard({ authorize: refuse('HOST_NOT_ALLOWLISTED') }),
      transport: async () => jsonResponse(),
    });
    await expect(notAllowlisted.execute(BASE_REQUEST)).rejects.toMatchObject({
      code: 'PROV_ALLOWLIST_DIMENSION_UNDECLARED',
      detail: { guardReason: 'HOST_NOT_ALLOWLISTED' },
    });

    const dnsDenied = new EgressFetchPort({
      guard: fakeGuard({ verifyPin: refuse('REBINDING_DETECTED') }),
      transport: async () => jsonResponse(),
    });
    await expect(dnsDenied.execute(BASE_REQUEST)).rejects.toMatchObject({
      code: 'PROV_DNS_POLICY_REFUSED',
      detail: { guardReason: 'REBINDING_DETECTED' },
    });

    const resolutionRefused = new EgressFetchPort({
      guard: fakeGuard({ authorize: refuse('RESOLUTION_REFUSED') }),
      transport: async () => jsonResponse(),
    });
    await expect(resolutionRefused.execute(BASE_REQUEST)).rejects.toMatchObject({
      code: 'PROV_DNS_POLICY_REFUSED',
    });
  });

  it('follows an approved same-host redirect through a fresh authorize + pin round-trip', async () => {
    const guard = fakeGuard();
    let call = 0;
    const urls: string[] = [];
    const port = new EgressFetchPort({
      guard,
      transport: async (input) => {
        urls.push(input.url);
        call += 1;
        if (call === 1) {
          return jsonResponse({ status: 302, locationHeader: '/defi/quotation/v1/tokens/price/next' });
        }
        return jsonResponse();
      },
    });
    const response = await port.execute(BASE_REQUEST);
    expect(response.status).toBe(200);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe(`${BASE_REQUEST.url}/next`);
    // The redirected target was authorized on its own merits.
    expect(guard.authorizeCalls).toEqual([BASE_REQUEST.url, `${BASE_REQUEST.url}/next`]);
  });

  it('refuses cross-host redirects as a redirect-policy violation', async () => {
    // The port's built-in approval policy only ever approves same-host hops.
    const guard = fakeGuard();
    const transport = vi.fn(async () =>
      jsonResponse({ status: 302, locationHeader: 'https://exfiltrate.example/collect' }),
    );
    const port = new EgressFetchPort({ guard, transport });
    await expect(port.execute(BASE_REQUEST)).rejects.toMatchObject({
      code: 'PROV_REDIRECT_POLICY_REFUSED',
      detail: { guardReason: 'REDIRECT_UNAPPROVED' },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('refuses redirect chains beyond the configured limit', async () => {
    const port = new EgressFetchPort({
      guard: fakeGuard(),
      transport: async () =>
        jsonResponse({ status: 302, locationHeader: `${BASE_REQUEST.url}?hop=next` }),
      maxRedirects: 2,
    });
    await expect(port.execute(BASE_REQUEST)).rejects.toMatchObject({
      code: 'PROV_REDIRECT_POLICY_REFUSED',
    });
  });

  it('refuses responses whose content type is outside the declared set', async () => {
    const transport = vi.fn(async () => jsonResponse({ contentType: 'text/html' }));
    const port = new EgressFetchPort({ guard: fakeGuard(), transport });
    await expect(port.execute(BASE_REQUEST)).rejects.toMatchObject({
      code: 'PROV_RESPONSE_CONTENT_TYPE_REFUSED',
      detail: { actual: 'text/html' },
    });
  });

  it('refuses responses exceeding the per-operation byte ceiling', async () => {
    const transport = vi.fn(async () =>
      jsonResponse({ bodyBytes: new Uint8Array(70_000) }),
    );
    const port = new EgressFetchPort({ guard: fakeGuard(), transport });
    await expect(port.execute(BASE_REQUEST)).rejects.toMatchObject({
      code: 'PROV_RESPONSE_BYTES_EXCEEDED',
      detail: { byteSize: 70_000, maxResponseBytes: 65_536 },
    });
  });
});
