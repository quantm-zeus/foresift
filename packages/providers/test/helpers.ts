/**
 * Shared wiring for adapter contract tests: an EgressGuard whose resolver
 * pins deterministic documentation-range addresses, plus the GMGN/Helius
 * allowlist entries the reference adapters declare.
 */
import { EgressGuard } from '@foresift/security';
import type { EgressAllowlistEntry } from '@foresift/shared-schemas';
import {
  GMGN_OPERATIONS,
  HELIUS_OPERATIONS,
} from '../src/index.ts';

export const PINNED_RESOLVER = async (host: string): Promise<readonly string[]> => {
  // Deterministic documentation-range pinning — never a real network.
  return host.endsWith('.gmgn.ai') ? ['203.0.113.10'] : ['203.0.113.20'];
};

export function testAllowlist(): EgressAllowlistEntry[] {
  const entryOf = (host: string, port: number, plane: EgressAllowlistEntry['plane']): EgressAllowlistEntry => ({
    host,
    port,
    scheme: 'https',
    plane,
  });
  return [
    ...GMGN_OPERATIONS.map((e) => entryOf(e.descriptor.host, e.descriptor.port, 'COLLECTOR')),
    ...HELIUS_OPERATIONS.map((e) => entryOf(e.descriptor.host, e.descriptor.port, 'COLLECTOR')),
    // Distinct planes must NOT admit these destinations.
    ...GMGN_OPERATIONS.slice(0, 1).map((e) => entryOf(e.descriptor.host, e.descriptor.port, 'ALPHA_LAB')),
  ];
}

export function testGuard(): EgressGuard {
  return new EgressGuard({
    allowlist: testAllowlist(),
    resolver: PINNED_RESOLVER,
    limits: { maxResponseBytes: 1024 * 1024 },
  });
}

export function jsonResponse(bodyText: string, contentType = 'application/json') {
  return {
    status: 200,
    headers: { 'content-type': contentType },
    bodyBytes: Buffer.byteLength(bodyText, 'utf8'),
    bodyText,
  };
}
