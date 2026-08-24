// Egress guard (T118): deny-by-default allowlists, URL parsing defenses,
// denied IP ranges, pin→connect rebinding counter, redirect revalidation,
// response caps.
import { describe, expect, it } from 'vitest';
import { EgressGuard, isDeniedAddress } from '../src/egress.ts';

const ALLOWLIST = [
  { host: 'api.helius.dev', port: 443, scheme: 'https' as const, plane: 'COLLECTOR' as const },
  {
    host: 'api.coingecko.com',
    port: 443,
    scheme: 'https' as const,
    plane: 'CONTROL_PLANE' as const,
  },
];

const PUBLIC_DNS = ['140.82.112.3'];

function guard(answers: Record<string, readonly string[]> = {}) {
  return new EgressGuard({
    allowlist: ALLOWLIST,
    resolver: async (host) => answers[host] ?? PUBLIC_DNS,
  });
}

describe('egress allowlisting is deny-by-default (AC-051)', () => {
  it('allows an exact plane+host+port hit with pinned addresses', async () => {
    const decision = await guard().authorize('https://api.helius.dev/v0', 'COLLECTOR');
    expect(decision).toMatchObject({ decision: 'ALLOW', host: 'api.helius.dev' });
    if (decision.decision === 'ALLOW') expect(decision.pinnedAddresses).toEqual(PUBLIC_DNS);
  });

  it('refuses hosts not on the PLANE-specific allowlist', async () => {
    // api.helius.dev is COLLECTOR-only: the control plane may not reach it.
    const decision = await guard().authorize('https://api.helius.dev/v0', 'CONTROL_PLANE');
    expect(decision).toMatchObject({ decision: 'REFUSE', reason: 'HOST_NOT_ALLOWLISTED' });
  });

  it('refuses non-https schemes and unsafe ports before any resolution', async () => {
    const g = guard();
    let resolveCalls = 0;
    const counting = new EgressGuard({
      allowlist: ALLOWLIST,
      resolver: async () => {
        resolveCalls += 1;
        return PUBLIC_DNS;
      },
    });
    expect(await counting.authorize('http://api.helius.dev/', 'COLLECTOR')).toMatchObject({
      decision: 'REFUSE',
      reason: 'SCHEME_REFUSED',
    });
    expect(await counting.authorize('https://api.helius.dev:22/', 'COLLECTOR')).toMatchObject({
      decision: 'REFUSE',
      reason: 'PORT_UNSAFE',
    });
    expect(resolveCalls).toBe(0);
    void g;
  });

  it('refuses userinfo-bearing, encoded, and punycode hosts', async () => {
    const g = guard();
    expect(await g.authorize('https://user:pass@api.helius.dev/', 'COLLECTOR')).toMatchObject({
      decision: 'REFUSE',
      reason: 'URL_MALFORMED',
    });
    expect(await g.authorize('https://api%2Ehelius%2Edev/', 'COLLECTOR')).toMatchObject({
      decision: 'REFUSE',
      reason: 'HOST_NOT_ALLOWLISTED',
    });
    expect(await g.authorize('https://xn--helius-9cd.dev/', 'COLLECTOR')).toMatchObject({
      decision: 'REFUSE',
      reason: 'HOST_NOT_ALLOWLISTED',
    });
  });
});

describe('denied IP ranges (AC-257)', () => {
  it('denies loopback, private, link-local, metadata; IPv4 and IPv6', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.9',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.7',
      '0.0.0.0',
      '::1',
      '::ffff:127.0.0.1',
      'fe80::1',
      'fc00::5',
    ]) {
      expect(isDeniedAddress(address), address).toBe(true);
    }
    for (const address of ['140.82.112.3', '2606:50c0:8000::153']) {
      expect(isDeniedAddress(address), address).toBe(false);
    }
  });

  it('refuses when ANY resolved address falls in a denied range', async () => {
    const decision = await guard({
      'api.helius.dev': ['140.82.112.3', '169.254.169.254'],
    }).authorize('https://api.helius.dev/', 'COLLECTOR');
    expect(decision).toMatchObject({ decision: 'REFUSE', reason: 'ADDRESS_DENIED' });
  });

  it('detects DNS rebinding between pin and connect', async () => {
    let call = 0;
    const rebinding = new EgressGuard({
      allowlist: ALLOWLIST,
      resolver: async () => (call++ === 0 ? ['140.82.112.3'] : ['127.0.0.1']),
    });
    const first = await rebinding.authorize('https://api.helius.dev/', 'COLLECTOR');
    if (first.decision !== 'ALLOW') throw new Error('expected first allow');
    const second = await rebinding.verifyPin('https://api.helius.dev/', first.pinnedAddresses);
    expect(second).toMatchObject({ decision: 'REFUSE', reason: 'REBINDING_DETECTED' });
  });
});

describe('redirects and response caps (AC-257)', () => {
  it('revalidates every hop with approval callback and hop cap', async () => {
    const g = guard();
    const approved = await g.authorizeRedirect(
      'https://api.helius.dev/final',
      'COLLECTOR',
      1,
      () => true,
    );
    expect(approved.decision).toBe('ALLOW');

    expect(
      await g.authorizeRedirect('https://api.helius.dev/x', 'COLLECTOR', 1, () => false),
    ).toMatchObject({
      decision: 'REFUSE',
      reason: 'REDIRECT_UNAPPROVED',
    });
    expect(
      await g.authorizeRedirect('https://api.helius.dev/x', 'COLLECTOR', 3, () => true),
    ).toMatchObject({
      decision: 'REFUSE',
      reason: 'REDIRECT_LIMIT_EXCEEDED',
    });
    // A redirect off the plane's allowlist refuses like any first request.
    expect(
      await g.authorizeRedirect('https://api.coingecko.com/', 'COLLECTOR', 1, () => true),
    ).toMatchObject({
      decision: 'REFUSE',
      reason: 'HOST_NOT_ALLOWLISTED',
    });
  });

  it('enforces byte, time, decompression-ratio, and content-type caps', () => {
    const strict = new EgressGuard({
      allowlist: ALLOWLIST,
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
    expect(
      strict.inspectResponse({
        bytes: 10,
        timeMs: 5,
        decompressedBytes: 20,
        contentType: 'application/json',
      }).decision,
    ).toBe('ALLOW');
  });

  it('requireAllowed raises typed EgressError for wiring that prefers exceptions', async () => {
    const g = guard();
    const decision = await g.authorize('ftp://api.helius.dev/', 'COLLECTOR');
    expect(() => g.requireAllowed(decision)).toThrow(/SCHEME_REFUSED|refused/);
  });
});
