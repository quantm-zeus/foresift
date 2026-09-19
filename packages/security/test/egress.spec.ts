// Egress guard (T118): deny-by-default allowlists, URL parsing defenses,
// denied IP ranges, pin→connect rebinding counter, redirect revalidation,
// response caps.
import { describe, expect, it } from 'bun:test';
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

  it('classifies embedded-IPv4 transports numerically and fails closed when unparseable', () => {
    for (const address of [
      '::ffff:7f00:1', // hex-spelled IPv4-mapped loopback (= ::ffff:127.0.0.1)
      '::FFFF:7F00:1', // same address, upper-case spelling
      '::ffff:a9fe:11ab', // mapped link-local (cloud-metadata space)
      '::ffff:c0a8:101', // mapped RFC1918 192.168.1.1
      '64:ff9b::7f00:1', // NAT64 well-known prefix wrapping loopback
      '64:ff9b::a9fe:11ab', // NAT64 wrapping link-local metadata
      '2002:7f00:1::', // 6to4 wrapping loopback
      '2002:a9fe:11ab::', // 6to4 wrapping link-local metadata
      '2130706433', // decimal spelling of 127.0.0.1 — unparseable ⇒ denied
      '0x7f000001', // hex spelling — unparseable ⇒ denied
      '127.1', // partial quad — not canonical ⇒ denied
      'fe80::1%eth0', // zone index — unparseable ⇒ denied
      '::zzzz', // resolver garbage — unparseable ⇒ denied
      '1:2:3:4:5:6:7:8:9', // over-long group set — unparseable ⇒ denied
    ]) {
      expect(isDeniedAddress(address), address).toBe(true);
    }
    for (const address of [
      '::ffff:140.82.112.3', // mapped PUBLIC address follows IPv4 rules → allowed
      '::ffff:8c52:7003', // hex form of the same public address
      '64:ff9b::8c52:7003', // NAT64 toward a public address
      '2002:8c52:7003::', // 6to4 toward a public address
      '2606:50c0:8000::153', // ordinary global unicast
    ]) {
      expect(isDeniedAddress(address), address).toBe(false);
    }
  });

  it('the authorize flow refuses hex-mapped and NAT64 spellings of denied ranges', async () => {
    const g = guard({ 'api.helius.dev': ['::ffff:7f00:1'] });
    const decision = await g.authorize('https://api.helius.dev/', 'COLLECTOR');
    expect(decision).toMatchObject({ decision: 'REFUSE', reason: 'ADDRESS_DENIED' });
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

// --- Shadow-safe authority (D018): numeric-index decision walks --------------

/**
 * A same-process caller can replace `Array.prototype` primitives at DECISION
 * time. Each shadow below is exactly the one that would flip the specific
 * fail-closed gate to ALLOW before the numeric-index conversion, is installed
 * only for the call under test, and is restored in a `finally`.
 */
describe('egress decision gates resist Array.prototype shadowing (D018)', () => {
  const proto = Array.prototype as unknown as Record<string, unknown>;

  async function withShadow<T>(
    method: string,
    replacement: unknown,
    run: () => T | Promise<T>,
  ): Promise<T> {
    const original = proto[method];
    proto[method] = replacement;
    try {
      return await run();
    } finally {
      proto[method] = original;
    }
  }

  it('refuses a non-allowlisted host even when Array.prototype.some is shadowed to true', async () => {
    const decision = await withShadow(
      'some',
      () => true,
      () => guard().authorize('https://evil.example/', 'COLLECTOR'),
    );
    expect(decision).toMatchObject({ decision: 'REFUSE', reason: 'HOST_NOT_ALLOWLISTED' });
    // Discriminating: pre-fix the shadowed `.some` also faked the punycode
    // predicate, so the refusal detail was "punycode host refused".
    expect((decision as { readonly detail?: string }).detail ?? '').toContain('not allowlisted');
  });

  it('still ALLOWs an allowlisted host when Array.prototype.some is shadowed to false', async () => {
    const decision = await withShadow(
      'some',
      () => false,
      () => guard().authorize('https://api.helius.dev/v0', 'COLLECTOR'),
    );
    expect(decision).toMatchObject({ decision: 'ALLOW', host: 'api.helius.dev' });
  });

  it('refuses a punycode host even when Array.prototype.some is shadowed to false', async () => {
    const decision = await withShadow(
      'some',
      () => false,
      () => guard().authorize('https://xn--helius-9cd.dev/', 'COLLECTOR'),
    );
    expect(decision).toMatchObject({ decision: 'REFUSE', reason: 'HOST_NOT_ALLOWLISTED' });
    // Discriminating: pre-fix the shadowed `.some` disabled punycode detection,
    // so the same reason arrived with an "not allowlisted" detail instead.
    expect((decision as { readonly detail?: string }).detail ?? '').toContain('punycode');
  });

  it('detects rebinding even when Array.prototype.join is shadowed to a constant', async () => {
    const rebinding = new EgressGuard({
      allowlist: ALLOWLIST,
      resolver: async () => ['127.0.0.1'],
    });
    const decision = await withShadow(
      'join',
      () => 'shadowed',
      () => rebinding.verifyPin('https://api.helius.dev/', ['140.82.112.3']),
    );
    expect(decision).toMatchObject({ decision: 'REFUSE', reason: 'REBINDING_DETECTED' });
  });

  it('detects rebinding even when Array.prototype.sort is shadowed to drop elements', async () => {
    const rebinding = new EgressGuard({
      allowlist: ALLOWLIST,
      resolver: async () => ['127.0.0.1'],
    });
    const decision = await withShadow(
      'sort',
      () => [],
      () => rebinding.verifyPin('https://api.helius.dev/', ['140.82.112.3']),
    );
    expect(decision).toMatchObject({ decision: 'REFUSE', reason: 'REBINDING_DETECTED' });
  });

  it('refuses a disallowed content type even when Array.prototype.includes is shadowed to true', async () => {
    const strict = new EgressGuard({
      allowlist: ALLOWLIST,
      resolver: async () => PUBLIC_DNS,
      limits: { allowedContentTypes: ['application/json'] },
    });
    const decision = await withShadow(
      'includes',
      () => true,
      () => strict.inspectResponse({ contentType: 'text/html' }),
    );
    expect(decision).toMatchObject({ decision: 'REFUSE', reason: 'CONTENT_TYPE_REFUSED' });
  });

  it('refuses with a real verdict even when the schema library internals are shadowed (R13 HIGH)', async () => {
    // zod's ObjectType._parse uses `for...of` + `push`; shadowing `push` makes
    // `Schema.parse` return `{}`. Pre-fix `authorize` returned that `{}` and a
    // consumer checking `decision === 'REFUSE'` treated it as non-refusal.
    const proto = Array.prototype as unknown as Record<string, unknown>;
    const originalPush = proto['push'];
    let decision: { readonly decision?: string; readonly reason?: string } = {};
    proto['push'] = () => 0;
    try {
      decision = (await guard().authorize('https://evil.example/', 'COLLECTOR')) as unknown as {
        readonly decision?: string;
        readonly reason?: string;
      };
    } finally {
      proto['push'] = originalPush;
    }
    expect(decision.decision).toBe('REFUSE');
    expect(decision.reason).toBe('HOST_NOT_ALLOWLISTED');
  });
});

// --- V7 security-review M1–M3: finite numeric binding + resolver pinning -----
describe('egress binds numeric carriers once and validates finiteness (V7 review M1–M3)', () => {
  it('REFUSES a NaN/Infinity response byte or time measurement instead of lifting caps (M2)', () => {
    const g = guard();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(g.inspectResponse({ bytes: bad })).toMatchObject({
        decision: 'REFUSE',
        reason: 'RESPONSE_BYTES_EXCEEDED',
      });
      expect(g.inspectResponse({ timeMs: bad })).toMatchObject({
        decision: 'REFUSE',
        reason: 'RESPONSE_TIME_EXCEEDED',
      });
      expect(g.inspectResponse({ bytes: 10, decompressedBytes: bad })).toMatchObject({
        decision: 'REFUSE',
        reason: 'DECOMPRESSION_RATIO_EXCEEDED',
      });
    }
    expect(
      g.inspectResponse({ bytes: 10, timeMs: 5, contentType: 'application/json' }).decision,
    ).toBe('ALLOW');
  });

  it('REFUSES a NaN/fractional/negative redirect hop count instead of disabling the hop cap (M3)', async () => {
    const g = guard();
    for (const hops of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5]) {
      const decision = await g.authorizeRedirect(
        'https://api.helius.dev/v0',
        'COLLECTOR',
        hops,
        () => true,
      );
      expect(decision).toMatchObject({ decision: 'REFUSE', reason: 'REDIRECT_LIMIT_EXCEEDED' });
    }
  });

  it('REFUSES a non-string resolved address instead of pinning the live carrier (M1)', async () => {
    const boxed = new String('140.82.112.3') as unknown as string;
    const g = new EgressGuard({ allowlist: ALLOWLIST, resolver: async () => [boxed] });
    const decision = await g.authorize('https://api.helius.dev/v0', 'COLLECTOR');
    expect(decision).toMatchObject({ decision: 'REFUSE', reason: 'ADDRESS_DENIED' });
  });
});
