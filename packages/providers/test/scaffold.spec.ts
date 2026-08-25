/**
 * Package scaffold smoke test (same arrangement as the proven security and
 * provider-lifecycle packages): the entrypoint compiles and the injectable
 * transport seam is exported for composition — before concrete adapters
 * land in this package.
 */
import { describe, expect, it } from 'vitest';
import type { FetchPort, ProviderHttpRequest, ProviderHttpResponse } from '../src/index.ts';

describe('providers scaffold (FR-PROV-004…008 substrate)', () => {
  it('exposes the FetchPort seam with GET-only request shape', async () => {
    const requests: ProviderHttpRequest[] = [];
    const port: FetchPort = {
      async fetch(request) {
        requests.push(request);
        const response: ProviderHttpResponse = {
          status: 200,
          contentType: 'application/json',
          bodyText: '{"ok":true}',
        };
        return response;
      },
    };

    const result = await port.fetch({ url: 'https://provider.example/api/v1/account' });
    expect(result.status).toBe(200);
    expect(result.bodyText).toBe('{"ok":true}');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://provider.example/api/v1/account');
  });
});
