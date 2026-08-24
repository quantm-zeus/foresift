// AC-257 (acceptance): the complete SSRF fixture battery fails CLOSED.
// Line one: deny-by-default allowlisting refuses every loopback/private/
// link-local/metadata/encoded target outright. Line two: even an allowlisted
// name that resolves into a denied range (poisoned/rebinding DNS) refuses
// with ADDRESS_DENIED before any connection.
import { describe, expect, it } from 'vitest';
import { EgressGuard } from '../../packages/security/src/egress.ts';
import {
  ADMITTED_PUBLIC_TARGETS,
  ENCODED_BYPASS_TARGETS,
  METADATA_AND_LOOPBACK_TARGETS,
} from '../fixtures/sec/ssrf/ssrf-urls.ts';

const PUBLIC_DNS = ['140.82.112.3'];
const LEGIT_HOSTS = ['api.coingecko.com', 'solana.publicnode.com', 'raw.githubusercontent.com'];

function legitGuard(): EgressGuard {
  return new EgressGuard({
    allowlist: LEGIT_HOSTS.map((host) => ({
      host,
      port: 443,
      scheme: 'https' as const,
      plane: 'COLLECTOR' as const,
    })),
    resolver: async () => PUBLIC_DNS,
  });
}

describe('AC-257: every SSRF fixture class fails closed', () => {
  it('line 1 — refuses loopback/metadata targets by allowlist policy alone', async () => {
    const guard = legitGuard();
    for (const url of METADATA_AND_LOOPBACK_TARGETS) {
      const decision = await guard.authorize(url.replace(/^http:/, 'https:'), 'COLLECTOR');
      expect(decision.decision, url).toBe('REFUSE');
      if (decision.decision === 'REFUSE') {
        expect(
          ['HOST_NOT_ALLOWLISTED', 'SCHEME_REFUSED', 'URL_MALFORMED', 'PORT_UNSAFE'],
          url,
        ).toContain(decision.reason);
      }
    }
  });

  it('line 1 — refuses every encoded/truncated/userinfo bypass shape', async () => {
    const guard = legitGuard();
    for (const url of ENCODED_BYPASS_TARGETS) {
      const decision = await guard.authorize(url, 'COLLECTOR');
      expect(decision.decision, url).toBe('REFUSE');
    }
  });

  it('line 2 — ANY allowlisted name resolving into a denied range refuses', async () => {
    // Poisoned DNS scenarios: the approved collector host resolves (per the
    // controllable resolver seam) into each denied class — loopback,
    // RFC1918, link-local/metadata, CGNAT, IPv6 equivalents.
    const deniedAnswers = [
      ['127.0.0.1'],
      ['10.1.2.3'],
      ['172.16.0.9'],
      ['192.168.1.1'],
      ['169.254.169.254'],
      ['100.64.0.7'],
      ['::1'],
      ['::ffff:127.0.0.1'],
      ['fe80::1'],
      ['fc00::5'],
    ];
    for (const addresses of deniedAnswers) {
      const poisoned = new EgressGuard({
        allowlist: [{ host: 'api.coingecko.com', port: 443, scheme: 'https', plane: 'COLLECTOR' }],
        resolver: async () => addresses,
      });
      const decision = await poisoned.authorize('https://api.coingecko.com/', 'COLLECTOR');
      expect(decision, addresses.join(',')).toMatchObject({
        decision: 'REFUSE',
        reason: 'ADDRESS_DENIED',
      });
    }
  });

  it('positive control — legitimate public research targets still pass', async () => {
    const guard = legitGuard();
    for (const url of ADMITTED_PUBLIC_TARGETS) {
      const decision = await guard.authorize(url, 'COLLECTOR');
      expect(decision.decision, url).toBe('ALLOW');
    }
  });
});
