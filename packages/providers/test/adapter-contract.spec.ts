/**
 * Adapter-contract suite (FR-PROV-005, AC-257): the eleven-dimension
 * allowlist enforced deny-by-default across BOTH layers — the security
 * EgressGuard (scheme/host/port/DNS+IP) and this package's contract layer
 * (method/path-template/query-fields/content-type/max-bytes/response-
 * schema/redirects) — with a clean allowlisted request flowing end-to-end.
 * Every refusal carries a typed code naming the violated dimension.
 */
import { describe, expect, it } from 'vitest';
import { AdapterContract } from '../src/adapter-contract.ts';
import { GMGN_OPERATIONS } from '../src/operation-catalogs/gmgn.catalog.ts';
import { ProvErrorCode } from '@foresift/provider-lifecycle';
import {
  expectTypedThrow,
  fixtureFetch,
  jsonResponse,
  PUBLIC_IP,
  staticResolver,
  GMGN_TOKEN_SECURITY_FIXTURE,
} from './fixtures.ts';

const RESOLVER = staticResolver({ 'gmgn.ai': [PUBLIC_IP] });

function contract(): AdapterContract {
  return new AdapterContract({ descriptors: GMGN_OPERATIONS.map((e) => e.allowlist), resolver: RESOLVER });
}

const TOKEN_SECURITY = 'gmgn/token-security-read';

describe('clean path: allowlisted request flows end-to-end', () => {
  it('authorizes, fetches via the injected port, validates, and returns parsed data', async () => {
    const seen: string[] = [];
    const adapter = contract();
    const body = await adapter.execute(
      fixtureFetch((request) => {
        seen.push(request.url);
        return jsonResponse(GMGN_TOKEN_SECURITY_FIXTURE);
      }),
      TOKEN_SECURITY,
      'https://gmgn.ai/api/v1/token_security/sol/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );
    expect(body).toEqual(GMGN_TOKEN_SECURITY_FIXTURE);
    expect(seen).toHaveLength(1);
    // The emitted request is GET-only by construction.
    expect(adapter.buildRequest(seen[0]!).method).toBe('GET');
  });
});

describe('contract-layer dimensions refuse deny-by-default', () => {
  it('refuses any non-GET method', async () => {
    await expect(
      contract().authorizeRequest(TOKEN_SECURITY, 'https://gmgn.ai/api/v1/token_security/sol/x', {
        method: 'POST' as never,
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ALLOWLIST_METHOD_REFUSED });
  });

  it('refuses undeclared hosts, ports, and schemes', async () => {
    const c = contract();
    await expect(
      c.authorizeRequest(TOKEN_SECURITY, 'https://evil.example.com/api/v1/token_security/sol/x'),
    ).rejects.toMatchObject({
      code: ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      detail: { dimension: 'host' },
    });
    await expect(
      c.authorizeRequest(TOKEN_SECURITY, 'https://gmgn.ai:8443/api/v1/token_security/sol/x'),
    ).rejects.toMatchObject({
      code: ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      detail: { dimension: 'port' },
    });
    await expect(
      c.authorizeRequest(TOKEN_SECURITY, 'http://gmgn.ai/api/v1/token_security/sol/x'),
    ).rejects.toMatchObject({
      code: ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      detail: { dimension: 'scheme' },
    });
  });

  it('refuses paths that do not match the declared template exactly', async () => {
    const c = contract();
    // Extra segment → different shape than /api/v1/token_security/{chain}/{address}.
    await expect(
      c.authorizeRequest(
        TOKEN_SECURITY,
        'https://gmgn.ai/api/v2/token_security/sol/x',
      ),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ALLOWLIST_PATH_REFUSED });
    await expect(
      c.authorizeRequest(TOKEN_SECURITY, 'https://gmgn.ai/api/v1/token_security/sol/x/extra'),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ALLOWLIST_PATH_REFUSED });
  });

  it('refuses request fields outside the query-parameter allowlist', async () => {
    await expect(
      contract().execute(
        fixtureFetch(() => jsonResponse(GMGN_TOKEN_SECURITY_FIXTURE)),
        TOKEN_SECURITY,
        'https://gmgn.ai/api/v1/token_security/sol/x?apikey=leaked-value',
      ),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ALLOWLIST_REQUEST_FIELD_REFUSED });
  });

  it('refuses responses on content type, byte cap, JSON, schema, status, redirects', async () => {
    const c = contract();
    const descriptor = c.descriptorFor(TOKEN_SECURITY)!;
    // Content type.
    expectTypedThrow(
      () => c.inspectResponse(descriptor, jsonResponse(GMGN_TOKEN_SECURITY_FIXTURE, { contentType: 'text/html' })),
      ProvErrorCode.PROV_ALLOWLIST_CONTENT_TYPE_REFUSED,
    );
    // Byte cap (descriptor allows 256 KiB; send more).
    expectTypedThrow(() => c.inspectResponse(descriptor, jsonResponse('x'.repeat(300_000))),
      ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      /exceeds the declared max/);
    // Invalid JSON.
    expectTypedThrow(
      () => c.inspectResponse(descriptor, jsonResponse('{not json')),
      ProvErrorCode.PROV_ALLOWLIST_RESPONSE_SCHEMA_REFUSED,
    );
    // Schema mismatch (data.holder_count must be a number when present).
    expectTypedThrow(
      () => c.inspectResponse(descriptor, jsonResponse({ data: { holder_count: 'many' } })),
      ProvErrorCode.PROV_ALLOWLIST_RESPONSE_SCHEMA_REFUSED,
    );
    // Non-success status.
    expectTypedThrow(() => c.inspectResponse(descriptor, jsonResponse({}, { status: 500 })),
      ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      /not a success/);
    // Redirect statuses are refused outright — following requires an explicit re-authorizing hop loop.
    expectTypedThrow(() => c.inspectResponse(descriptor, jsonResponse({}, { status: 302 })),
      ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      /redirect policy/);
  });

  it('refuses operations without any registered descriptor', async () => {
    await expect(
      contract().authorizeRequest('gmgn/never-declared', 'https://gmgn.ai/x'),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED });
  });
});

describe('egress layer composition (security EgressGuard)', () => {
  it('surfaces denied-range resolutions as typed egress refusals', async () => {
    const rebinding = new AdapterContract({
      descriptors: GMGN_OPERATIONS.map((e) => e.allowlist),
      resolver: staticResolver({ 'gmgn.ai': ['127.0.0.1'] }),
    });
    await expect(
      rebinding.execute(
        fixtureFetch(() => jsonResponse(GMGN_TOKEN_SECURITY_FIXTURE)),
        TOKEN_SECURITY,
        'https://gmgn.ai/api/v1/token_security/sol/x',
      ),
    ).rejects.toMatchObject({
      code: ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      detail: { dimension: 'dns-ip-policy', reason: 'ADDRESS_DENIED' },
    });
  });

  it('surfaces resolution failures as typed egress refusals', async () => {
    const dead = new AdapterContract({
      descriptors: GMGN_OPERATIONS.map((e) => e.allowlist),
      resolver: staticResolver({}),
    });
    await expect(
      dead.execute(
        fixtureFetch(() => jsonResponse(GMGN_TOKEN_SECURITY_FIXTURE)),
        TOKEN_SECURITY,
        'https://gmgn.ai/api/v1/token_security/sol/x',
      ),
    ).rejects.toMatchObject({
      detail: { dimension: 'dns-ip-policy', reason: 'RESOLUTION_REFUSED' },
    });
  });
});
