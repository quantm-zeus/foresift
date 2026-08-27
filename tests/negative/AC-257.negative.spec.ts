// AC-257 (negative): SSRF bypass vectors — userinfo, percent-encoded hosts,
// punycode lookalikes, mixed schemes, unsafe ports, DNS rebinding between
// pin and connect, unapproved redirects, and response-cap abuse (oversized
// bodies, slow streams, decompression bombs, disallowed content types) —
// each fail closed with their specific typed refusal.
import { describe, expect, it } from 'bun:test';
import { EgressGuard } from '../../packages/security/src/egress.ts';

const PUBLIC_DNS = ['140.82.112.3'];

function guard(answers: Record<string, readonly string[]> = {}): EgressGuard {
  return new EgressGuard({
    allowlist: [{ host: 'api.helius.dev', port: 443, scheme: 'https', plane: 'COLLECTOR' }],
    resolver: async (host) => answers[host] ?? PUBLIC_DNS,
  });
}

describe('AC-257 negative: every bypass vector refuses deterministically', () => {
  it('refuses userinfo-bearing URLs before resolution', async () => {
    let resolveCalls = 0;
    const counting = new EgressGuard({
      allowlist: [{ host: 'api.helius.dev', port: 443, scheme: 'https', plane: 'COLLECTOR' }],
      resolver: async () => {
        resolveCalls += 1;
        return PUBLIC_DNS;
      },
    });
    expect(
      await counting.authorize('https://user:pass@api.helius.dev/', 'COLLECTOR'),
    ).toMatchObject({ decision: 'REFUSE', reason: 'URL_MALFORMED' });
    expect(resolveCalls).toBe(0);
  });

  it('refuses percent-encoded and punycode host lookalikes', async () => {
    const g = guard();
    expect(await g.authorize('https://api%2Ehelius%2Edev/', 'COLLECTOR')).toMatchObject({
      decision: 'REFUSE',
      reason: 'HOST_NOT_ALLOWLISTED',
    });
    expect(await g.authorize('https://xn--helius-9cd.dev/', 'COLLECTOR')).toMatchObject({
      decision: 'REFUSE',
      reason: 'HOST_NOT_ALLOWLISTED',
    });
  });

  it('refuses mixed schemes and unsafe ports before any DNS work', async () => {
    const g = guard();
    expect(await g.authorize('http://api.helius.dev/', 'COLLECTOR')).toMatchObject({
      decision: 'REFUSE',
      reason: 'SCHEME_REFUSED',
    });
    expect(await g.authorize('ftp://api.helius.dev/', 'COLLECTOR')).toMatchObject({
      decision: 'REFUSE',
      reason: 'SCHEME_REFUSED',
    });
    expect(await g.authorize('https://api.helius.dev:22/', 'COLLECTOR')).toMatchObject({
      decision: 'REFUSE',
      reason: 'PORT_UNSAFE',
    });
  });

  it('detects rebinding between pin and connect', async () => {
    let call = 0;
    const rebinding = new EgressGuard({
      allowlist: [{ host: 'api.helius.dev', port: 443, scheme: 'https', plane: 'COLLECTOR' }],
      resolver: async () => (call++ === 0 ? ['140.82.112.3'] : ['127.0.0.1']),
    });
    const first = await rebinding.authorize('https://api.helius.dev/', 'COLLECTOR');
    if (first.decision !== 'ALLOW') throw new Error('expected clean first resolution');
    await expect(
      rebinding.verifyPin('https://api.helius.dev/', first.pinnedAddresses),
    ).resolves.toMatchObject({ decision: 'REFUSE', reason: 'REBINDING_DETECTED' });
  });

  it('revalidates redirects: unapproved hops and off-allowlist destinations refuse', async () => {
    const g = guard();
    expect(
      await g.authorizeRedirect('https://api.helius.dev/x', 'COLLECTOR', 1, () => false),
    ).toMatchObject({ decision: 'REFUSE', reason: 'REDIRECT_UNAPPROVED' });
    expect(
      await g.authorizeRedirect('https://api.helius.dev/x', 'COLLECTOR', 3, () => true),
    ).toMatchObject({ decision: 'REFUSE', reason: 'REDIRECT_LIMIT_EXCEEDED' });
    expect(
      await g.authorizeRedirect('https://169.254.169.254/', 'COLLECTOR', 1, () => true),
    ).toMatchObject({ decision: 'REFUSE', reason: 'HOST_NOT_ALLOWLISTED' });
  });

  it('enforces response caps: oversize, slow streams, bombs, content types', async () => {
    const strict = new EgressGuard({
      allowlist: [{ host: 'api.helius.dev', port: 443, scheme: 'https', plane: 'COLLECTOR' }],
      resolver: async () => PUBLIC_DNS,
      limits: {
        maxResponseBytes: 1000,
        maxResponseTimeMs: 500,
        maxDecompressionRatio: 10,
        allowedContentTypes: ['application/json'],
      },
    });
    expect(strict.inspectResponse({ bytes: 2000 })).toMatchObject({
      decision: 'REFUSE',
      reason: 'RESPONSE_BYTES_EXCEEDED',
    });
    expect(strict.inspectResponse({ timeMs: 501 })).toMatchObject({
      decision: 'REFUSE',
      reason: 'RESPONSE_TIME_EXCEEDED',
    });
    expect(strict.inspectResponse({ bytes: 100, decompressedBytes: 5000 })).toMatchObject({
      decision: 'REFUSE',
      reason: 'DECOMPRESSION_RATIO_EXCEEDED',
    });
    expect(strict.inspectResponse({ contentType: 'text/html' })).toMatchObject({
      decision: 'REFUSE',
      reason: 'CONTENT_TYPE_REFUSED',
    });
  });

  it('IPv6 denied forms refuse when a poisoned answer arrives', async () => {
    for (const answer of [
      ['::1'],
      ['::ffff:127.0.0.1'],
      ['fe80::1'],
      ['fc00::5'],
      // Hex-spelled mapped, NAT64, 6to4, and unparseable answers are the
      // historical bypasses — every spelling must hit the denial table.
      ['::ffff:7f00:1'],
      ['64:ff9b::7f00:1'],
      ['2002:7f00:1::'],
      ['2130706433'],
    ]) {
      const poisoned = new EgressGuard({
        allowlist: [{ host: 'api.helius.dev', port: 443, scheme: 'https', plane: 'COLLECTOR' }],
        resolver: async () => answer,
      });
      expect(
        await poisoned.authorize('https://api.helius.dev/', 'COLLECTOR'),
        answer[0],
      ).toMatchObject({ decision: 'REFUSE', reason: 'ADDRESS_DENIED' });
    }
  });
});
