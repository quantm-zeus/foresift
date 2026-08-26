/**
 * T114: deny-by-default enforcement on EVERY undeclared dimension of the
 * exact per-adapter allowlist descriptor — method, path template, query
 * fields, request fields, content types, redirect policy, response bytes,
 * response schema, and the egress layer beneath it all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  AdapterClient,
  AdapterRequestValidator,
  ProvAdapterErrorCode,
  recordedFetchPort,
} from '../src/index.ts';
import type { AllowlistDescriptor } from '../src/index.ts';
import type { FetchPort } from '../src/index.ts';
import { jsonResponse, testGuard } from './helpers.ts';

const GMGN_SECURITY_DESCRIPTOR: AllowlistDescriptor = {
  operationId: 'token.security',
  scheme: 'https',
  host: 'api.gmgn.ai',
  port: 443,
  pathTemplate: '/api/v1/tokens/{chain}/{address}/security',
  method: 'GET',
  requestContentTypes: [],
  responseContentTypes: ['application/json'],
  responseSchemaId: 'gmgn/token.security@1',
  allowedQueryFields: [],
  allowedRequestFields: [],
  redirectPolicy: 'REFUSE',
  maxRedirects: 0,
  maxResponseBytes: 1024 * 1024,
};

const SECURITY_RESPONSE_SCHEMA = z.object({ address: z.string().min(1) }).passthrough();

function securityClient(fetchPort: FetchPort): AdapterClient<{ address: string }> {
  return new AdapterClient<{ address: string }>({
    descriptor: GMGN_SECURITY_DESCRIPTOR,
    responseSchema: SECURITY_RESPONSE_SCHEMA,
    guard: testGuard(),
    plane: 'COLLECTOR',
    fetchPort,
  });
}

describe('T114 allowlist descriptor deny-by-default matrix', () => {
  const happyBody = JSON.stringify({ address: 'MINT1111', rug_ratio: 0 });

  it('a fully declared request flows through egress + validation to data', async () => {
    const port = recordedFetchPort(
      new Map([
        [
          'GET https://api.gmgn.ai:443/api/v1/tokens/sol/MINT1111/security',
          jsonResponse(happyBody),
        ],
      ]),
    );
    const result = await securityClient(port).execute({
      pathParams: { chain: 'sol', address: 'MINT1111' },
    });
    expect(result.status).toBe(200);
    expect(result.data.address).toBe('MINT1111');
    expect(result.url).toBe('https://api.gmgn.ai:443/api/v1/tokens/sol/MINT1111/security');
  });

  it('refuses an undeclared HTTP method', () => {
    const validator = new AdapterRequestValidator(GMGN_SECURITY_DESCRIPTOR);
    const failure = validator.checkMethod('POST');
    expect(failure?.code).toBe(ProvAdapterErrorCode.PROV_ADAPTER_METHOD_REFUSED);
    expect(validator.checkMethod('GET')).toBeNull();
  });

  it('refuses an undeclared query field (deny-by-default)', async () => {
    const port = recordedFetchPort(new Map());
    await expect(
      securityClient(port).execute({
        pathParams: { chain: 'sol', address: 'MINT1111' },
        query: { apiKey: 'leak-me' },
      }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_QUERY_FIELD_REFUSED });
  });

  it('refuses an undeclared JSON body field', async () => {
    const jsonRpcDescriptor = {
      ...GMGN_SECURITY_DESCRIPTOR,
      operationId: 'rpc.get_transaction',
      pathTemplate: '/',
      method: 'POST' as const,
      requestContentTypes: ['application/json'],
      allowedRequestFields: ['jsonrpc', 'id', 'method', 'params'],
    };
    const client = new AdapterClient({
      descriptor: jsonRpcDescriptor,
      responseSchema: z.object({ slot: z.number() }).passthrough(),
      guard: testGuard(),
      plane: 'COLLECTOR',
      fetchPort: recordedFetchPort(new Map()),
    });
    await expect(
      client.execute({
        body: { jsonrpc: '2.0', id: 1, method: 'getTransaction', smuggledField: true },
      }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_REQUEST_FIELD_REFUSED });
  });

  it('refuses a missing path parameter', async () => {
    const port = recordedFetchPort(new Map());
    await expect(
      securityClient(port).execute({ pathParams: { chain: 'sol' } }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_PATH_REFUSED });
  });

  it('surfaces an undeclared DESTINATION as a typed egress refusal', async () => {
    // Wrong-plane request: the allowlist carries this host only on COLLECTOR.
    const wrongPlane = new AdapterClient<{ address: string }>({
      descriptor: GMGN_SECURITY_DESCRIPTOR,
      responseSchema: SECURITY_RESPONSE_SCHEMA,
      guard: testGuard(),
      plane: 'CONTROL_PLANE',
      fetchPort: recordedFetchPort(new Map()),
    });
    await expect(
      wrongPlane.execute({ pathParams: { chain: 'sol', address: 'MINT1111' } }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_EGRESS_REFUSED });
  });

  it('refuses responses on undeclared content types', async () => {
    const port = recordedFetchPort(
      new Map([
        [
          'GET https://api.gmgn.ai:443/api/v1/tokens/sol/MINT1111/security',
          jsonResponse('<html>not json</html>', 'text/html'),
        ],
      ]),
    );
    await expect(
      securityClient(port).execute({ pathParams: { chain: 'sol', address: 'MINT1111' } }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_CONTENT_TYPE_REFUSED });
  });

  it('refuses responses above the declared byte cap', async () => {
    const bigDescriptor = {
      ...GMGN_SECURITY_DESCRIPTOR,
      maxResponseBytes: 16,
    };
    const client = new AdapterClient<{ address: string }>({
      descriptor: bigDescriptor,
      responseSchema: SECURITY_RESPONSE_SCHEMA,
      guard: testGuard(),
      plane: 'COLLECTOR',
      fetchPort: recordedFetchPort(
        new Map([
          [
            'GET https://api.gmgn.ai:443/api/v1/tokens/sol/MINT1111/security',
            jsonResponse(happyBody),
          ],
        ]),
      ),
    });
    await expect(
      client.execute({ pathParams: { chain: 'sol', address: 'MINT1111' } }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_RESPONSE_BYTES_EXCEEDED });
  });

  it('refuses recorded responses that violate the operation response schema', async () => {
    const port = recordedFetchPort(
      new Map([
        [
          'GET https://api.gmgn.ai:443/api/v1/tokens/sol/MINT1111/security',
          jsonResponse(JSON.stringify({ unexpected_shape: true })),
        ],
      ]),
    );
    await expect(
      securityClient(port).execute({ pathParams: { chain: 'sol', address: 'MINT1111' } }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_RESPONSE_INVALID });
  });

  it('redirects follow the descriptor policy — REFUSE means REFUSE', async () => {
    const client = securityClient(recordedFetchPort(new Map()));
    await expect(client.executeRedirect('https://evil.example.com/a', 0)).rejects.toMatchObject({
      code: ProvAdapterErrorCode.PROV_ADAPTER_REDIRECT_REFUSED,
    });
  });

  it('SAME_ORIGIN_APPROVED admits same-host hops and refuses cross-origin ones', async () => {
    const sameOriginDescriptor = {
      ...GMGN_SECURITY_DESCRIPTOR,
      redirectPolicy: 'SAME_ORIGIN_APPROVED' as const,
      maxRedirects: 2,
    };
    const validator = new AdapterRequestValidator(sameOriginDescriptor);
    expect(validator.checkRedirect('https://api.gmgn.ai/next', 0)).toBeNull();
    expect(validator.checkRedirect('https://api.gmgn.ai/next', 2)?.code).toBe(
      ProvAdapterErrorCode.PROV_ADAPTER_REDIRECT_REFUSED,
    );
    expect(validator.checkRedirect('https://other.example.net/next', 0)?.code).toBe(
      ProvAdapterErrorCode.PROV_ADAPTER_REDIRECT_REFUSED,
    );
  });

  it('the end-to-end fixture passes through the full gate stack', async () => {
    const fixture = readFileSync(
      new URL('./fixtures/gmgn/token-security.json', import.meta.url),
      'utf8',
    );
    const port = recordedFetchPort(
      new Map([
        [
          'GET https://api.gmgn.ai:443/api/v1/tokens/sol/So11111111111111111111111111111111111111112/security',
          jsonResponse(fixture),
        ],
      ]),
    );
    const result = await securityClient(port).execute({
      pathParams: { chain: 'sol', address: 'So11111111111111111111111111111111111111112' },
    });
    expect(result.data.address).toBe('So11111111111111111111111111111111111111112');
    expect((result.data as Record<string, unknown>)['rug_ratio']).toBe(0);
  });
});
