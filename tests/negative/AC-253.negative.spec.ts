// AC-253 (negative): grants missing PKCE, using near-miss redirect URIs,
// carrying wrong audiences/resource indicators, expired, or WIDENED beyond
// registered scopes refuse — and upstream tokens never pass through.
import { describe, expect, it } from 'vitest';
import { OAuthBindingGuard } from '../../packages/security/src/oauth-binding.ts';

const NOW_MS = Date.parse('2026-08-01T00:00:00Z');
const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

const GUARD = new OAuthBindingGuard(() => NOW_MS);

function goodBinding() {
  return {
    subject: 'user-1',
    clientId: 'mcp-client',
    redirectUri: 'https://mcp.example.com/callback',
    audience: 'foresift-mcp',
    resourceIndicator: 'https://foresift.example.com/mcp',
    scopes: ['tools:read'],
    expiresAt: at('2026-08-01T01:00:00Z'),
    pkceRequired: true as const,
  };
}

function validate(candidateOverrides: Record<string, unknown>, validationOverrides = {}) {
  return GUARD.validateTokenBinding({
    candidate: { ...goodBinding(), ...candidateOverrides },
    registeredRedirectUris: ['https://mcp.example.com/callback'],
    registeredScopes: ['tools:read', 'tools:write'],
    expectedAudience: 'foresift-mcp',
    expectedResourceIndicator: 'https://foresift.example.com/mcp',
    ...validationOverrides,
  });
}

describe('AC-253 negative: every under-bound grant refuses', () => {
  it('refuses grants WITHOUT PKCE', () => {
    expect(() => validate({ pkceRequired: false })).toThrow(/pkce/i);
  });

  it('refuses NON-EXACT redirect URIs — path, query, and case variants included', () => {
    for (const redirectUri of [
      'https://mcp.example.com/callback/',
      'https://mcp.example.com/callback?extra=1',
      'https://mcp.example.com/other',
      'https://evil.example.com/callback',
    ]) {
      expect(() => validate({ redirectUri }), redirectUri).toThrow(/redirect/i);
    }
  });

  it('refuses wrong AUDIENCE bindings', () => {
    expect(() => validate({ audience: 'alpha-lab' })).toThrow(/audience/i);
    expect(() => validate({}, { expectedAudience: 'alpha-lab' })).toThrow(/audience/i);
  });

  it('refuses wrong RESOURCE indicators', () => {
    expect(() => validate({ resourceIndicator: 'https://evil.example.com/mcp' })).toThrow(
      /resource/i,
    );
  });

  it('refuses EXPIRED grants against the injected clock', () => {
    expect(() => validate({ expiresAt: at('2026-07-31T23:59:59Z') })).toThrow(/expired/i);
  });

  it('refuses scope WIDENING beyond the registered set', () => {
    expect(() => validate({ scopes: ['tools:read', 'admin:*'] })).toThrow(/widen|scope/i);
  });

  it('refuses upstream provider tokens as passthrough credentials', () => {
    expect(() => GUARD.refuseUpstreamPassthrough({ isUpstreamIssued: true })).toThrow(/upstream/i);
    expect(() => GUARD.refuseUpstreamPassthrough({ upstreamIssuer: 'github' })).toThrow();
    expect(() => GUARD.refuseUpstreamPassthrough({})).not.toThrow();
  });
});
